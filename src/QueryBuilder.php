<?php

namespace Vifrost\Laravel;

use Closure;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Spatie\QueryBuilder\QueryBuilder as SpatieQueryBuilder;
use Vifrost\Laravel\Contracts\PaginatesItself;
use Vifrost\Laravel\Dataset\Dataset;
use Vifrost\Laravel\Dataset\DatasetLimits;
use Vifrost\Laravel\Dataset\DatasetRules;
use Vifrost\Laravel\Dataset\DatasetTimeout;
use Vifrost\Laravel\Dataset\StatementTimeout;

/**
 * Spatie's query builder, plus datasets: a collection request with ?select=, ?aggregate= or ?group=
 * returns rows of the columns, joins and aggregates it asks for, as far as allowedColumns(),
 * allowedJoins(), allowedHas() and allowedAggregates() permit. Every other request behaves
 * exactly as Spatie's.
 */
class QueryBuilder extends SpatieQueryBuilder implements PaginatesItself
{
    /**
     * Request attribute set while a dataset is being served.
     *
     * @var string
     */
    public const DATASET_ATTRIBUTE = 'vifrost.dataset';

    /**
     * Forwarded calls that read or run the query, which apply the dataset first so it sees
     * every rule regardless of the order they were chained in.
     *
     * @var array
     */
    private const READING_CALLS = [
        'tobase', 'tosql', 'torawsql', 'getquery', 'getbindings', 'get', 'first', 'firstorfail', 'count',
        'exists', 'doesntexist', 'pluck', 'value', 'cursor', 'lazy', 'chunk', 'paginate', 'simplepaginate',
        'cursorpaginate', 'getcountforpagination', 'limit', 'take', 'offset', 'skip', 'forpage',
    ];

    /**
     * The request whose dataset this query serves, or null for any other request.
     *
     * @var \Illuminate\Http\Request|null
     */
    private ?Request $datasetRequest = null;

    /**
     * @var \Vifrost\Laravel\Dataset\DatasetRules
     */
    private DatasetRules $datasetRules;

    /**
     * The applied dataset, once a reading call applied it.
     *
     * @var \Vifrost\Laravel\Dataset\Dataset|null
     */
    private ?Dataset $dataset = null;

    /**
     * Restores the session's statement timeout once the dataset's queries ran.
     *
     * @var \Closure|null
     */
    private ?Closure $restoreTimeout = null;

    /**
     * @param \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Eloquent\Relations\Relation $subject
     * @param \Illuminate\Http\Request|null $request defaults to the current request
     */
    public function __construct(EloquentBuilder|Relation $subject, ?Request $request = null)
    {
        $request ??= request();
        $this->datasetRules = new DatasetRules;

        if (Dataset::isRequested($request) && (new Vifrost)->isCollectionPath($request)) {
            $this->datasetRequest = $request;
            $request = $this->withoutListingParameters($request);
        }

        parent::__construct($subject, $request);
    }

    /**
     * Columns a dataset may select, filter, group or aggregate: the model's own, dotted for the
     * columns of a joined relation or of a has level.
     *
     * @param array|string $columns
     * @return static
     */
    public function allowedColumns($columns): static
    {
        $this->datasetRules->columns = is_array($columns) ? $columns : func_get_args();

        return $this;
    }

    /**
     * Relations a dataset may join: BelongsTo, HasOne, HasMany or BelongsToMany relations of the model.
     *
     * @param array|string $relations
     * @return static
     */
    public function allowedJoins($relations): static
    {
        $this->datasetRules->joins = is_array($relations) ? $relations : func_get_args();

        return $this;
    }

    /**
     * Relations a dataset may filter by with whereHas/whereDoesntHave, dotted for nested ones,
     * whose parent levels must be allowed too.
     *
     * @param array|string $relations
     * @return static
     */
    public function allowedHas($relations): static
    {
        $this->datasetRules->has = is_array($relations) ? $relations : func_get_args();

        return $this;
    }

    /**
     * Aggregate functions a dataset may use: count, sum, avg, min or max.
     *
     * @param array|string $functions
     * @return static
     */
    public function allowedAggregates($functions): static
    {
        $this->datasetRules->aggregates = is_array($functions) ? $functions : func_get_args();

        return $this;
    }

    /**
     * Whether this query serves a dataset.
     *
     * @return bool
     */
    public function isDataset(): bool
    {
        return ! is_null($this->datasetRequest);
    }

    /**
     * A dataset follows config('vifrost.dataset'): it always requires ?limit=, up to its own max.
     * Any other request is paginated like a list of records.
     *
     * @param string $modelClass model full classname
     * @param \Illuminate\Http\Request $request
     * @return bool
     */
    public function applyOwnPagination(string $modelClass, Request $request): bool
    {
        if (! $this->isDataset()) {
            return false;
        }

        DatasetLimits::apply($this, $modelClass, $request);

        return true;
    }

    /**
     * The rules this query allows its datasets.
     *
     * @return \Vifrost\Laravel\Dataset\DatasetRules
     */
    public function getDatasetRules(): DatasetRules
    {
        return $this->datasetRules;
    }

    /**
     * Runs the query. A dataset returns its rows as arrays keyed as requested, and reports a
     * query the database cancelled for running too long as a 504.
     *
     * @param array|string $columns
     * @return \Illuminate\Support\Collection
     */
    public function get($columns = ['*'])
    {
        if (! $this->isDataset()) {
            return parent::__call('get', func_get_args());
        }

        $this->applyDataset();

        try {
            return $this->dataset->present(parent::getEloquentBuilder()->toBase()->get());
        } catch (QueryException $exception) {
            throw StatementTimeout::isTimeout($exception) ? new DatasetTimeout($exception) : $exception;
        } finally {
            $this->restoreTimeout();
        }
    }

    /**
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public function getEloquentBuilder(): EloquentBuilder
    {
        $this->applyDataset();

        return parent::getEloquentBuilder();
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\Relation|\Illuminate\Database\Eloquent\Builder
     */
    public function getSubject(): Relation|EloquentBuilder
    {
        $this->applyDataset();

        return parent::getSubject();
    }

    /**
     * @param string $name
     * @param array $arguments
     * @return mixed
     */
    public function __call($name, $arguments)
    {
        if (in_array(strtolower($name), self::READING_CALLS, true)) {
            $this->applyDataset();
        }

        return parent::__call($name, $arguments);
    }

    /**
     * Applies the dataset to the query, once, and bounds how long its queries may run.
     *
     * @return void
     */
    private function applyDataset(): void
    {
        if (! $this->isDataset() || ! is_null($this->dataset)) {
            return;
        }

        $this->datasetRequest->attributes->set(self::DATASET_ATTRIBUTE, true);

        $dataset = new Dataset($this->datasetRules, $this->datasetRequest);
        $query = parent::getEloquentBuilder();
        $dataset->apply($query);
        $this->dataset = $dataset;

        $this->restoreTimeout = StatementTimeout::set(
            $query->getConnection(),
            DatasetLimits::timeoutFor(get_class($query->getModel()))
        );
        app()->terminating(fn () => $this->restoreTimeout());
    }

    /**
     * Restores the session's statement timeout, if this dataset changed it.
     *
     * @return void
     */
    private function restoreTimeout(): void
    {
        if (! is_null($this->restoreTimeout)) {
            ($this->restoreTimeout)();
        }
    }

    /**
     * A copy of a request without the parameters Spatie reads, which a dataset does not use.
     *
     * @param \Illuminate\Http\Request $request
     * @return \Illuminate\Http\Request
     */
    private function withoutListingParameters(Request $request): Request
    {
        $parameters = array_map(
            fn (string $parameter) => config("query-builder.parameters.{$parameter}", $parameter),
            ['filter', 'include', 'sort', 'fields', 'append']
        );

        return $request->duplicate(Arr::except($request->query->all(), $parameters));
    }
}
