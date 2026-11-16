<?php

namespace Vifrost\Laravel\Dataset;

use Closure;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Query\Expression;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use LogicException;

/**
 * One dataset request applied to a query: the columns and aggregates it selects, the relations
 * it joins, the conditions and whereHas it filters by, how it groups and sorts, and how its rows
 * are returned. Columns and relations come only from the allowed rules; the request supplies
 * values, which are always bound.
 */
class Dataset
{
    /**
     * Query parameters that turn a collection request into a dataset.
     *
     * @var array
     */
    public const TRIGGERS = ['select', 'aggregate', 'group'];

    /**
     * Column a joined BelongsToMany selects the parent's key from its pivot table under.
     *
     * @var string
     */
    private const PIVOT_PARENT_KEY = 'vifrost_pivot_parent_key';

    /**
     * Periods a date column can be grouped by.
     *
     * @var array
     */
    public const PERIOD_UNITS = ['day', 'week', 'month', 'year'];

    /**
     * Comparison operators a condition accepts, mapped to SQL.
     *
     * @var array
     */
    private const COMPARISONS = ['=' => '=', '!=' => '<>', '<' => '<', '<=' => '<=', '>' => '>', '>=' => '>='];

    /**
     * Operators a condition accepts besides comparisons.
     *
     * @var array
     */
    private const SET_OPERATORS = ['in', 'notIn', 'between', 'null', 'notNull'];

    /**
     * Requested output keys by the SQL alias that selects them, with how to cast their values.
     *
     * @var array<string, array{key: string, cast: string|null}>
     */
    private array $outputs = [];

    /**
     * SQL aliases of the joined relations, by relation name.
     *
     * @var array<string, string>
     */
    private array $joined = [];

    /**
     * Resolved columns of the plain selected paths, by path.
     *
     * @var array<string, string>
     */
    private array $selectedColumns = [];

    /**
     * How many aggregates the dataset selects.
     *
     * @var int
     */
    private int $aggregateCount = 0;

    /**
     * Columns the dataset groups by, as requested.
     *
     * @var array
     */
    private array $groupColumns = [];

    /**
     * Date periods the dataset groups by, as `column:unit` by output key.
     *
     * @var array<string, string>
     */
    private array $groupPeriods = [];

    /**
     * @param \Vifrost\Laravel\Dataset\DatasetRules $rules
     * @param \Illuminate\Http\Request $request the request with the dataset's parameters
     */
    public function __construct(
        private DatasetRules $rules,
        private Request $request
    ) {
    }

    /**
     * Whether a request asks for a dataset.
     *
     * @param \Illuminate\Http\Request $request
     * @return bool
     */
    public static function isRequested(Request $request): bool
    {
        foreach (self::TRIGGERS as $parameter) {
            if ($request->query->has($parameter)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Applies the dataset to a query of its root model.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @return void
     */
    public function apply(EloquentBuilder $query): void
    {
        $model = $query->getModel();

        if (! $this->rules->isEnabled()) {
            throw InvalidDatasetQuery::notEnabled(get_class($model));
        }

        $this->rules->validate($model);

        $query->getQuery()->select([]);
        $query->getQuery()->reorder();

        $this->applyJoins($query, $model);
        $this->applySelects($query, $model);
        [$this->groupColumns, $this->groupPeriods] = $this->groupParameter();
        $this->applyPeriods($query, $model);
        $this->applyAggregates($query, $model);

        if ($this->outputs === []) {
            throw InvalidDatasetQuery::malformed('A dataset needs at least one ?select= column, ?aggregate= or date period in ?group=.');
        }

        $this->applyConditions($query, $this->arrayParameter('where'), fn (string $path) => $this->rootColumn($model, $path), 'where');
        $this->applyHas($query, $model, $this->arrayParameter('has'), '', 1);
        $this->applyGroups($query, $model);
        $this->applySorts($query);
    }

    /**
     * Turns the rows the query returned into the dataset's rows: the requested keys, with
     * aggregates as numbers.
     *
     * @param \Illuminate\Support\Collection $rows rows selected under the dataset's SQL aliases
     * @return \Illuminate\Support\Collection
     */
    public function present(Collection $rows): Collection
    {
        return $rows->map(function ($row) {
            $values = (array) $row;
            $presented = [];
            foreach ($this->outputs as $alias => $output) {
                $presented[$output['key']] = self::cast($values[$alias] ?? null, $output['cast']);
            }

            return $presented;
        });
    }

    /**
     * Joins the requested relations, each through its own model's query() so its scoping
     * applies, along with the conditions the relation itself declares, or straight to its table
     * when neither restricts it. A BelongsToMany is joined through its pivot table.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param \Illuminate\Database\Eloquent\Model $model
     * @return void
     */
    private function applyJoins(EloquentBuilder $query, Model $model): void
    {
        foreach ($this->listParameter('join') as $join) {
            [$name, $type] = array_pad(explode(':', $join, 2), 2, 'inner');

            if (! in_array($name, $this->rules->joins, true)) {
                throw InvalidDatasetQuery::notAllowed('Join', $name, $this->rules->joins);
            }
            if (! in_array($type, ['inner', 'left'], true)) {
                throw InvalidDatasetQuery::malformed("Join type `{$type}` is not supported. Use inner or left.");
            }
            if (isset($this->joined[$name])) {
                continue;
            }

            $alias = 'vj_' . $name;
            $relation = Relation::noConstraints(fn () => DatasetRules::relation($model, $name));
            $related = RelatedQuery::for($relation->getRelated())->mergeConstraintsFrom($relation->getQuery());

            if ($relation instanceof BelongsToMany) {
                $related->join(
                    $relation->getTable(),
                    $relation->getQualifiedRelatedKeyName(),
                    '=',
                    $relation->getQualifiedRelatedPivotKeyName()
                )->select(
                    $relation->getRelated()->getTable() . '.*',
                    $relation->getQualifiedForeignPivotKeyName() . ' as ' . self::PIVOT_PARENT_KEY
                );
                $query->joinSub($related, $alias, $relation->getQualifiedParentKeyName(), '=', $alias . '.' . self::PIVOT_PARENT_KEY, $type);
                $this->joined[$name] = $alias;
                continue;
            }

            [$local, $foreign] = $relation instanceof BelongsTo
                ? [$relation->getQualifiedForeignKeyName(), $alias . '.' . $relation->getOwnerKeyName()]
                : [$relation->getQualifiedParentKeyName(), $alias . '.' . $relation->getForeignKeyName()];

            if (RelatedQuery::isUnconstrained($related)) {
                $query->join($related->getModel()->getTable() . ' as ' . $alias, $local, '=', $foreign, $type);
            } else {
                $query->joinSub($related, $alias, $local, '=', $foreign, $type);
            }

            $this->joined[$name] = $alias;
        }
    }

    /**
     * Selects the requested columns, each under the path it was requested by.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param \Illuminate\Database\Eloquent\Model $model
     * @return void
     */
    private function applySelects(EloquentBuilder $query, Model $model): void
    {
        foreach ($this->listParameter('select') as $path) {
            $column = $this->rootColumn($model, $path);
            $alias = $this->addOutput($path, null);
            $this->selectedColumns[$path] = $column;
            $query->addSelect($column . ' as ' . $alias);
        }
    }

    /**
     * Selects the requested aggregates, each under its own key: `fn` or `fn:column`.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param \Illuminate\Database\Eloquent\Model $model
     * @return void
     */
    private function applyAggregates(EloquentBuilder $query, Model $model): void
    {
        $aggregates = $this->request->query('aggregate', []);

        if (! is_array($aggregates) || array_is_list($aggregates) && $aggregates !== []) {
            throw InvalidDatasetQuery::malformed('?aggregate= takes keys, e.g. aggregate[total]=count or aggregate[revenue]=sum:amount.');
        }

        $grammar = $query->getQuery()->getGrammar();

        foreach ($aggregates as $key => $spec) {
            if (! is_string($spec) || ! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', (string) $key)) {
                throw InvalidDatasetQuery::malformed("Aggregate `{$key}` needs a key of letters, digits and underscores, and a function.");
            }

            [$function, $path] = array_pad(explode(':', $spec, 2), 2, null);

            if (! in_array($function, $this->rules->aggregates, true)) {
                throw InvalidDatasetQuery::notAllowed('Aggregate', (string) $function, $this->rules->aggregates);
            }
            if (is_null($path) && $function !== 'count') {
                throw InvalidDatasetQuery::malformed("Aggregate `{$key}` needs a column: {$function}:column.");
            }

            $argument = is_null($path) ? '*' : $grammar->wrap($this->rootColumn($model, $path));
            $alias = $this->addOutput((string) $key, $function === 'count' ? 'int' : ($function === 'sum' || $function === 'avg' ? 'float' : 'number'));
            $query->selectRaw(strtoupper($function) . '(' . $argument . ') as ' . $grammar->wrap($alias));
            $this->aggregateCount++;
        }
    }

    /**
     * Splits ?group= into the columns it groups by, given as a list (`group=status,kind` or
     * `group[]=status`), and the date periods, given by output key (`group[month]=created_at:month`).
     *
     * @return array{0: array, 1: array<string, string>}
     */
    private function groupParameter(): array
    {
        $value = $this->request->query('group', []);

        if (is_string($value)) {
            $value = explode(',', $value);
        }

        if (! is_array($value)) {
            throw InvalidDatasetQuery::malformed('?group= takes columns, e.g. group[]=status, and periods, e.g. group[month]=created_at:month.');
        }

        $columns = [];
        $periods = [];

        foreach ($value as $key => $item) {
            if (! is_string($item)) {
                throw InvalidDatasetQuery::malformed('Each ?group= entry is a column or a column:unit period.');
            }
            if (is_int($key)) {
                if (trim($item) !== '') {
                    $columns[] = trim($item);
                }
                continue;
            }
            $periods[$key] = $item;
        }

        return [$columns, $periods];
    }

    /**
     * Groups by the day, week (starting on Monday), month or year of date columns, each selected
     * under its own key as the first date of its period.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param \Illuminate\Database\Eloquent\Model $model
     * @return void
     */
    private function applyPeriods(EloquentBuilder $query, Model $model): void
    {
        $grammar = $query->getQuery()->getGrammar();

        foreach ($this->groupPeriods as $key => $spec) {
            if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', (string) $key)) {
                throw InvalidDatasetQuery::malformed("Period `{$key}` of ?group= needs a key of letters, digits and underscores.");
            }

            [$path, $unit] = array_pad(explode(':', $spec, 2), 2, null);

            if (! in_array($unit, self::PERIOD_UNITS, true)) {
                throw InvalidDatasetQuery::notAllowed('Period unit', (string) $unit, self::PERIOD_UNITS);
            }

            $expression = self::periodExpression(
                $query->getConnection()->getDriverName(),
                $grammar->wrap($this->rootColumn($model, $path)),
                $unit
            );
            $alias = $this->addOutput((string) $key, null);
            $query->selectRaw($expression . ' as ' . $grammar->wrap($alias));
            $query->groupBy(new Expression($expression));
        }
    }

    /**
     * The SQL that truncates a date column to the first date of its period, as `YYYY-MM-DD`.
     *
     * @param string $driver
     * @param string $column the wrapped column
     * @param string $unit day, week, month or year
     * @return string
     */
    private static function periodExpression(string $driver, string $column, string $unit): string
    {
        return match ($driver) {
            'pgsql' => "CAST(DATE_TRUNC('{$unit}', {$column}) AS DATE)",
            'mysql', 'mariadb' => match ($unit) {
                'day' => "DATE({$column})",
                'week' => "DATE_SUB(DATE({$column}), INTERVAL WEEKDAY({$column}) DAY)",
                'month' => "DATE_FORMAT({$column}, '%Y-%m-01')",
                'year' => "DATE_FORMAT({$column}, '%Y-01-01')",
            },
            'sqlite' => match ($unit) {
                'day' => "date({$column})",
                'week' => "date({$column}, 'weekday 0', '-6 days')",
                'month' => "strftime('%Y-%m-01', {$column})",
                'year' => "strftime('%Y-01-01', {$column})",
            },
            default => throw InvalidDatasetQuery::malformed("Date periods are not supported on {$driver}."),
        };
    }

    /**
     * Adds conditions to a query, each a column comparison or a group of them: `or` matches
     * any of its conditions, `and` all of them.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param array $conditions
     * @param \Closure(string): string $column resolves a requested column to the one to compare
     * @param string $parameter where the conditions were given, for error messages
     * @param string $boolean how the conditions join the ones before them
     * @return void
     */
    private function applyConditions(EloquentBuilder $query, array $conditions, Closure $column, string $parameter, string $boolean = 'and'): void
    {
        foreach ($conditions as $condition) {
            if (! is_array($condition)) {
                throw InvalidDatasetQuery::malformed("Each condition of ?{$parameter}= needs a column, an op and usually a value.");
            }

            foreach (['or', 'and'] as $group) {
                if (array_key_exists($group, $condition)) {
                    if (! is_array($condition[$group])) {
                        throw InvalidDatasetQuery::malformed("A `{$group}` group of ?{$parameter}= needs a list of conditions.");
                    }
                    $query->where(
                        fn (EloquentBuilder $nested) => $this->applyConditions($nested, $condition[$group], $column, $parameter, $group),
                        null,
                        null,
                        $boolean
                    );
                    continue 2;
                }
            }

            $this->applyCondition($query, $condition, $column, $parameter, $boolean);
        }
    }

    /**
     * Adds one column condition to a query.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param array $condition { column, op, value }
     * @param \Closure(string): string $column
     * @param string $parameter
     * @param string $boolean
     * @return void
     */
    private function applyCondition(EloquentBuilder $query, array $condition, Closure $column, string $parameter, string $boolean): void
    {
        $path = $condition['column'] ?? null;
        $operator = $condition['op'] ?? null;

        if (! is_string($path) || ! is_string($operator)) {
            throw InvalidDatasetQuery::malformed("Each condition of ?{$parameter}= needs a column and an op.");
        }

        $resolved = $column($path);
        $value = $condition['value'] ?? null;

        if (array_key_exists($operator, self::COMPARISONS)) {
            if (! is_scalar($value)) {
                throw InvalidDatasetQuery::malformed("`{$path} {$operator}` needs a single value.");
            }
            $query->where($resolved, self::COMPARISONS[$operator], $value, $boolean);
            return;
        }

        switch ($operator) {
            case 'in':
            case 'notIn':
                $query->whereIn($resolved, $this->listValue($path, $operator, $value), $boolean, $operator === 'notIn');
                return;
            case 'between':
                $query->whereBetween($resolved, $this->listValue($path, $operator, $value, 2), $boolean);
                return;
            case 'null':
            case 'notNull':
                $query->whereNull($resolved, $boolean, $operator === 'notNull');
                return;
            default:
                throw InvalidDatasetQuery::notAllowed(
                    'Operator',
                    $operator,
                    array_merge(array_keys(self::COMPARISONS), self::SET_OPERATORS)
                );
        }
    }

    /**
     * A condition's value as a list of scalars, of an exact size when given.
     *
     * @param string $path
     * @param string $operator
     * @param mixed $value
     * @param int|null $size
     * @return array
     */
    private function listValue(string $path, string $operator, $value, ?int $size = null): array
    {
        $isList = is_array($value) && $value !== [] && count(array_filter($value, 'is_scalar')) === count($value);

        if (! $isList || (! is_null($size) && count($value) !== $size)) {
            $expected = is_null($size) ? 'a list of values' : "exactly {$size} values";
            throw InvalidDatasetQuery::malformed("`{$path} {$operator}` needs {$expected}.");
        }

        return array_values($value);
    }

    /**
     * Filters a query by the existence of related records, keyed by relation name: each with
     * optional conditions on the related columns, a count (`>=2`), `negate` for whereDoesntHave
     * and `has` for the relations of the related model. Each related query is restricted to the
     * records its own model's query() reads.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param \Illuminate\Database\Eloquent\Model $model
     * @param array $has
     * @param string $prefix dotted path of the relations above this level
     * @param int $depth this level, starting at 1
     * @return void
     */
    private function applyHas(EloquentBuilder $query, Model $model, array $has, string $prefix, int $depth): void
    {
        if ($has === []) {
            return;
        }

        if ($depth > DatasetLimits::maxHasDepth()) {
            throw InvalidDatasetQuery::malformed('?has= nests deeper than ' . DatasetLimits::maxHasDepth() . ' levels.');
        }

        foreach ($has as $name => $spec) {
            $path = $prefix === '' ? (string) $name : $prefix . '.' . $name;

            if (! in_array($path, $this->rules->has, true)) {
                throw InvalidDatasetQuery::notAllowed('Has', $path, $this->rules->has);
            }
            if (! is_array($spec)) {
                $spec = [];
            }

            $related = DatasetRules::relation($model, (string) $name)->getRelated();
            $negate = filter_var($spec['negate'] ?? false, FILTER_VALIDATE_BOOLEAN);
            [$operator, $count] = $this->hasCount($path, $spec['count'] ?? null, $negate);
            $conditions = $spec['where'] ?? [];
            $nested = $spec['has'] ?? [];

            if (! is_array($conditions) || ! is_array($nested)) {
                throw InvalidDatasetQuery::malformed("The `where` and `has` of has `{$path}` need lists.");
            }

            $constrain = function (EloquentBuilder $relatedQuery) use ($related, $path, $conditions, $nested, $depth) {
                $this->restrictToRelatedQuery($relatedQuery, $related);
                $this->applyConditions(
                    $relatedQuery,
                    $conditions,
                    fn (string $column) => $this->hasColumn($related, $path, $column),
                    "has[{$path}]"
                );
                $this->applyHas($relatedQuery, $related, $nested, $path, $depth + 1);
            };

            $negate
                ? $query->whereDoesntHave((string) $name, $constrain)
                : $query->whereHas((string) $name, $constrain, $operator, $count);
        }
    }

    /**
     * Parses the count of a has level: `>=2`, `<3`, `0`; at least one by default.
     *
     * @param string $path
     * @param mixed $count
     * @param bool $negate
     * @return array{0: string, 1: int}
     */
    private function hasCount(string $path, $count, bool $negate): array
    {
        if (is_null($count) || $count === '') {
            return ['>=', 1];
        }

        if ($negate) {
            throw InvalidDatasetQuery::malformed("Has `{$path}` cannot be negated and counted at once.");
        }

        if (! is_string($count) || ! preg_match('/^(>=|<=|!=|>|<|=)?(\d+)$/', $count, $matches)) {
            throw InvalidDatasetQuery::malformed("The count of has `{$path}` must look like >=2, <3 or 0.");
        }

        return [$matches[1] === '' ? '>=' : $matches[1], (int) $matches[2]];
    }

    /**
     * Restricts a related query to the records its model's query() reads, when that query
     * reads less than the whole table.
     *
     * @param \Illuminate\Database\Eloquent\Builder $relatedQuery
     * @param \Illuminate\Database\Eloquent\Model $related
     * @return void
     */
    private function restrictToRelatedQuery(EloquentBuilder $relatedQuery, Model $related): void
    {
        $scoped = RelatedQuery::for($related);

        if (RelatedQuery::isUnconstrained($scoped)) {
            return;
        }

        if (is_null($related->getKeyName())) {
            throw new LogicException(
                'A dataset cannot filter by ' . class_basename($related) . ' through its query(), since its key is composite.'
            );
        }

        $relatedQuery->whereIn($related->getQualifiedKeyName(), $scoped->select($related->getQualifiedKeyName()));
    }

    /**
     * Groups by the requested columns. Once a dataset groups or aggregates, every selected
     * column must be grouped. A dataset of aggregates alone returns one row.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param \Illuminate\Database\Eloquent\Model $model
     * @return void
     */
    private function applyGroups(EloquentBuilder $query, Model $model): void
    {
        $groups = $this->groupColumns;
        $isGrouped = $groups !== [] || $this->groupPeriods !== [];

        foreach ($groups as $path) {
            $query->groupBy($this->rootColumn($model, $path));
        }

        if (! $isGrouped && $this->aggregateCount === 0) {
            return;
        }

        foreach (array_keys($this->selectedColumns) as $path) {
            if (! in_array($path, $groups, true)) {
                throw InvalidDatasetQuery::malformed("Column `{$path}` is selected but not grouped; add it to ?group=.");
            }
        }

        if (! $isGrouped) {
            $query->havingRaw('1 = 1');
        }
    }

    /**
     * Sorts by the requested output keys, `-` first for descending.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @return void
     */
    private function applySorts(EloquentBuilder $query): void
    {
        $aliases = array_flip(array_map(fn (array $output) => $output['key'], $this->outputs));

        foreach ($this->listParameter('sort') as $sort) {
            $descending = str_starts_with($sort, '-');
            $key = ltrim($sort, '-');

            if (! isset($aliases[$key])) {
                throw InvalidDatasetQuery::notAllowed('Sort', $key, array_keys($aliases));
            }

            $query->orderBy($aliases[$key], $descending ? 'desc' : 'asc');
        }
    }

    /**
     * Resolves a column of the root model, or of a joined relation when dotted.
     *
     * @param \Illuminate\Database\Eloquent\Model $model
     * @param string $path
     * @return string
     */
    private function rootColumn(Model $model, string $path): string
    {
        if (! in_array($path, $this->rules->columns, true)) {
            throw InvalidDatasetQuery::notAllowed('Column', $path, $this->rules->columns);
        }

        if (! str_contains($path, '.')) {
            return $model->qualifyColumn($path);
        }

        [$relation, $column] = explode('.', $path, 2);

        if (str_contains($column, '.') || ! isset($this->joined[$relation])) {
            throw InvalidDatasetQuery::malformed("Column `{$path}` needs ?join={$relation} first.");
        }

        return $this->joined[$relation] . '.' . $column;
    }

    /**
     * Resolves a column of a has level, given without the relation path.
     *
     * @param \Illuminate\Database\Eloquent\Model $related
     * @param string $path the has level's dotted relation path
     * @param string $column
     * @return string
     */
    private function hasColumn(Model $related, string $path, string $column): string
    {
        $qualified = $path . '.' . $column;

        if (str_contains($column, '.') || ! in_array($qualified, $this->rules->columns, true)) {
            throw InvalidDatasetQuery::notAllowed('Column', $qualified, $this->rules->columns);
        }

        return $related->qualifyColumn($column);
    }

    /**
     * Registers an output key and returns the SQL alias that selects it.
     *
     * @param string $key
     * @param string|null $cast
     * @return string
     */
    private function addOutput(string $key, ?string $cast): string
    {
        foreach ($this->outputs as $output) {
            if ($output['key'] === $key) {
                throw InvalidDatasetQuery::malformed("`{$key}` is requested twice.");
            }
        }

        $alias = 'c' . count($this->outputs);
        $this->outputs[$alias] = ['key' => $key, 'cast' => $cast];

        return $alias;
    }

    /**
     * A comma-separated or array parameter as a list of names.
     *
     * @param string $name
     * @return array
     */
    private function listParameter(string $name): array
    {
        $value = $this->request->query($name, []);

        if (is_string($value)) {
            $value = explode(',', $value);
        }

        if (! is_array($value) || count(array_filter($value, 'is_string')) !== count($value)) {
            throw InvalidDatasetQuery::malformed("?{$name}= takes a comma-separated list.");
        }

        return array_values(array_filter(array_map('trim', $value), fn ($item) => $item !== ''));
    }

    /**
     * A structured parameter, such as the conditions of ?where= or the levels of ?has=.
     *
     * @param string $name
     * @return array
     */
    private function arrayParameter(string $name): array
    {
        $value = $this->request->query($name, []);

        if (! is_array($value)) {
            throw InvalidDatasetQuery::malformed("?{$name}= takes bracketed fields, e.g. {$name}[0][column]=status.");
        }

        return $value;
    }

    /**
     * Casts a selected value: aggregates as numbers, columns as the database returned them.
     *
     * @param mixed $value
     * @param string|null $cast
     * @return mixed
     */
    private static function cast($value, ?string $cast)
    {
        if (is_null($value) || is_null($cast)) {
            return $value;
        }

        return match ($cast) {
            'int' => (int) $value,
            'float' => (float) $value,
            'number' => is_numeric($value) ? $value + 0 : $value,
        };
    }
}
