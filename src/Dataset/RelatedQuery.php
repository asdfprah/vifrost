<?php

namespace Vifrost\Laravel\Dataset;

use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use LogicException;
use Spatie\QueryBuilder\QueryBuilder as SpatieQueryBuilder;
use Vifrost\Laravel\Vifrost;

/**
 * The query a dataset joins or filters a related model through: the one the related model's own
 * controller builds in query(), so its scoping and authorization apply to the dataset too.
 */
class RelatedQuery
{
    /**
     * Builds the related model's query the way its controller's query() does for its index
     * route, with no filters, sorts or includes.
     *
     * @param \Illuminate\Database\Eloquent\Model $related
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public static function for(Model $related): EloquentBuilder
    {
        $modelClass = get_class($related);
        $controllerClass = Vifrost::queryControllerFor($modelClass);

        if (is_null($controllerClass)) {
            throw new LogicException(
                'A dataset reaches ' . $modelClass . ' only through ' . Vifrost::controllerFor($modelClass) . '::query(), which scopes and authorizes it.'
            );
        }

        $request = Request::create('/' . strtolower(class_basename($modelClass)), 'GET');
        $query = app($controllerClass)->query($request);

        return $query instanceof SpatieQueryBuilder ? $query->getEloquentBuilder() : $query;
    }

    /**
     * Whether a related query reads the whole table, so the dataset can join the table itself
     * instead of a subquery.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @return bool
     */
    public static function isUnconstrained(EloquentBuilder $query): bool
    {
        $base = $query->toBase();

        return empty($base->wheres)
            && empty($base->joins)
            && empty($base->groups)
            && empty($base->havings)
            && is_null($base->limit)
            && is_null($base->offset)
            && $base->from === $query->getModel()->getTable();
    }
}
