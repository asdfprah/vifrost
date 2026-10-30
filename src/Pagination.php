<?php

namespace Vifrost\Laravel;

use Illuminate\Http\Request;

class Pagination{

    /**
     * The effective max_limit for a model: its own entry in
     * config('vifrost.max_limit_per_model') if it has one, else the global
     * config('vifrost.max_limit'). Null means the model is explicitly exempted
     * from pagination — unbounded results are allowed.
     *
     * @param string $modelClass model full classname, with or without a leading
     *   backslash — Vifrost::guessModel() returns one, get_class()/::class never
     *   do, and config('vifrost.max_limit_per_model') is naturally written with
     *   ::class, so this normalizes rather than requiring every caller to remember to.
     * @return int|null
     */
    public static function maxLimitFor(string $modelClass){
        $modelClass = ltrim($modelClass, '\\');
        $perModel = config('vifrost.max_limit_per_model', []);
        return array_key_exists($modelClass, $perModel)
            ? $perModel[$modelClass]
            : config('vifrost.max_limit', 100);
    }

    /**
     * Resolves the limit to actually apply to a collection query, from the given
     * request or the current one. Null means no limit should be applied at all (the
     * model is exempt and the request didn't ask for one either).
     *
     * @param string $modelClass model full classname
     * @param \Illuminate\Http\Request|null $request defaults to the current request
     * @return int|null
     */
    public static function resolveLimit(string $modelClass, ?Request $request = null){
        $request = $request ?? request();
        $maxLimit = self::maxLimitFor($modelClass);

        if(is_null($maxLimit)){
            return $request->has('limit') ? max(1, (int) $request->input('limit')) : null;
        }

        return max(1, min((int) $request->input('limit', $maxLimit), (int) $maxLimit));
    }

    /**
     * Resolves the offset to actually apply to a collection query, from the given
     * request or the current one.
     *
     * @param \Illuminate\Http\Request|null $request defaults to the current request
     * @return int
     */
    public static function resolveOffset(?Request $request = null):int{
        return max(0, (int) ($request ?? request())->input('offset', 0));
    }

    /**
     * Applies the resolved limit and offset to a collection query. Aborts with 422 when
     * ?offset= is given without ?limit= for a model exempt from pagination.
     *
     * @param \Spatie\QueryBuilder\QueryBuilder|\Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Eloquent\Relations\Relation $query
     * @param string $modelClass model full classname
     * @param \Illuminate\Http\Request|null $request defaults to the current request
     * @return void
     */
    public static function apply($query, string $modelClass, ?Request $request = null): void{
        $request = $request ?? request();
        $limit = self::resolveLimit($modelClass, $request);

        if( is_null($limit) && $request->has('offset') ){
            abort(422, '?offset= requires ?limit= to also be provided for this resource.');
        }

        if( ! is_null($limit) ){
            $query->limit($limit)->offset(self::resolveOffset($request));
        }
    }
}
