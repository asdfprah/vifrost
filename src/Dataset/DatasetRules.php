<?php

namespace Vifrost\Laravel\Dataset;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Database\Eloquent\Relations\Relation;
use LogicException;

/**
 * What a model's query() allows its datasets to use: columns (dotted for joined and has
 * relations), joins, whereHas relations (dotted for nested ones) and aggregate functions.
 */
class DatasetRules
{
    /**
     * Aggregate functions a dataset can be allowed to use.
     *
     * @var array
     */
    public const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max'];

    /**
     * @var array
     */
    public array $columns = [];

    /**
     * @var array
     */
    public array $joins = [];

    /**
     * @var array
     */
    public array $has = [];

    /**
     * @var array
     */
    public array $aggregates = [];

    /**
     * Builds the rules of a controller's allowedDataset(): lists under `columns`, `joins`, `has`
     * and `aggregates`, each optional.
     *
     * @param array $rules
     * @return static
     */
    public static function fromArray(array $rules): static
    {
        $known = ['columns', 'joins', 'has', 'aggregates'];

        foreach ($rules as $key => $value) {
            if (! in_array($key, $known, true)) {
                throw new LogicException("Dataset rule `{$key}` is unknown. Use any of: " . implode(', ', $known) . '.');
            }
            if (! is_array($value) || ! array_is_list($value)) {
                throw new LogicException("Dataset rule `{$key}` must be a list.");
            }
        }

        $instance = new static;
        foreach ($known as $key) {
            $instance->{$key} = array_values($rules[$key] ?? []);
        }

        return $instance;
    }

    /**
     * Whether any dataset can be built: at least one column or aggregate is allowed.
     *
     * @return bool
     */
    public function isEnabled(): bool
    {
        return $this->columns !== [] || $this->aggregates !== [];
    }

    /**
     * Checks the rules make sense for the model they belong to, so a mistake in a controller
     * surfaces on its first dataset rather than as a leak: every join and has level resolves to
     * a supported relation, every nested has declares its parent levels, and no column is one
     * the model it belongs to hides from serialization.
     *
     * @param \Illuminate\Database\Eloquent\Model $root
     * @return void
     */
    public function validate(Model $root): void
    {
        foreach (array_diff($this->aggregates, self::AGGREGATES) as $aggregate) {
            throw new LogicException("`{$aggregate}` is not a dataset aggregate. Use any of: " . implode(', ', self::AGGREGATES) . '.');
        }

        foreach ($this->joins as $join) {
            if (str_contains($join, '.')) {
                throw new LogicException("Dataset join `{$join}` is nested; datasets join relations of the model itself.");
            }
            self::assertJoinable($root, $join);
        }

        foreach ($this->has as $path) {
            $segments = explode('.', $path);
            for ($depth = 1; $depth < count($segments); $depth++) {
                $parent = implode('.', array_slice($segments, 0, $depth));
                if (! in_array($parent, $this->has, true)) {
                    throw new LogicException("Dataset has `{$path}` needs its parent `{$parent}` to be allowed too.");
                }
            }
            self::relatedModel($root, $segments);
        }

        foreach ($this->columns as $column) {
            $this->assertVisible($root, $column);
        }
    }

    /**
     * Resolves the model a dotted relation path ends at, starting from a model.
     *
     * @param \Illuminate\Database\Eloquent\Model $model
     * @param array $relationNames
     * @return \Illuminate\Database\Eloquent\Model
     */
    public static function relatedModel(Model $model, array $relationNames): Model
    {
        foreach ($relationNames as $name) {
            $model = self::relation($model, $name)->getRelated();
        }

        return $model;
    }

    /**
     * The relation a model declares under a name.
     *
     * @param \Illuminate\Database\Eloquent\Model $model
     * @param string $name
     * @return \Illuminate\Database\Eloquent\Relations\Relation
     */
    public static function relation(Model $model, string $name): Relation
    {
        $relation = method_exists($model, $name) ? $model->{$name}() : null;

        if (! $relation instanceof Relation) {
            throw new LogicException(class_basename($model) . " has no relation `{$name}`.");
        }

        return $relation;
    }

    /**
     * Fails unless a relation can be joined: BelongsTo, HasOne, HasMany or BelongsToMany.
     *
     * @param \Illuminate\Database\Eloquent\Model $model
     * @param string $name
     * @return void
     */
    private static function assertJoinable(Model $model, string $name): void
    {
        $relation = self::relation($model, $name);
        $joinable = ($relation instanceof BelongsTo && ! $relation instanceof MorphTo)
            || ($relation instanceof BelongsToMany && ! $relation instanceof MorphToMany)
            || $relation instanceof HasOne
            || $relation instanceof HasMany;

        if (! $joinable) {
            throw new LogicException(
                'Dataset join `' . $name . '` is a ' . class_basename($relation) . '; only BelongsTo, HasOne, HasMany and BelongsToMany can be joined.'
            );
        }
    }

    /**
     * Fails if a column is one its model hides from serialization.
     *
     * @param \Illuminate\Database\Eloquent\Model $root
     * @param string $path column, dotted for a joined or has relation
     * @return void
     */
    private function assertVisible(Model $root, string $path): void
    {
        $segments = explode('.', $path);
        $column = array_pop($segments);
        $model = self::relatedModel($root, $segments);
        $visible = $model->getVisible();

        if (in_array($column, $model->getHidden(), true) || ($visible !== [] && ! in_array($column, $visible, true))) {
            throw new LogicException("Dataset column `{$path}` is hidden by " . class_basename($model) . '.');
        }
    }
}
