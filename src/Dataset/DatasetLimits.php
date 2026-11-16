<?php

namespace Vifrost\Laravel\Dataset;

use Illuminate\Http\Request;

/**
 * The bounds config('vifrost.dataset') sets on what a dataset of a model may do.
 */
class DatasetLimits
{
    /**
     * The max rows a dataset of a model may request: its entry in
     * config('vifrost.dataset.max_limit_per_model'), or config('vifrost.dataset.max_limit').
     * A dataset is never exempt from a limit, so a null entry falls back to the global one.
     *
     * @param string $modelClass model full classname, with or without a leading backslash
     * @return int
     */
    public static function maxLimitFor(string $modelClass): int
    {
        $perModel = config('vifrost.dataset.max_limit_per_model', []);

        return (int) ($perModel[ltrim($modelClass, '\\')] ?? config('vifrost.dataset.max_limit', 1000));
    }

    /**
     * The milliseconds each query of a dataset of a model may run, or null when it may run
     * as long as the database allows.
     *
     * @param string $modelClass model full classname, with or without a leading backslash
     * @return int|null
     */
    public static function timeoutFor(string $modelClass): ?int
    {
        $modelClass = ltrim($modelClass, '\\');
        $perModel = config('vifrost.dataset.timeout_ms_per_model', []);
        $timeout = array_key_exists($modelClass, $perModel)
            ? $perModel[$modelClass]
            : config('vifrost.dataset.timeout_ms', 5000);

        return is_null($timeout) ? null : (int) $timeout;
    }

    /**
     * The deepest whereHas a dataset may nest, counting the first level.
     *
     * @return int
     */
    public static function maxHasDepth(): int
    {
        return (int) config('vifrost.dataset.max_has_depth', 3);
    }

    /**
     * Applies the requested limit and offset to a dataset. A dataset always requires ?limit=,
     * and one over the model's max is rejected rather than clamped, since a truncated export
     * would silently lose rows.
     *
     * @param mixed $query the dataset's query builder
     * @param string $modelClass model full classname
     * @param \Illuminate\Http\Request $request
     * @return void
     */
    public static function apply($query, string $modelClass, Request $request): void
    {
        $max = self::maxLimitFor($modelClass);
        $limit = $request->query('limit');

        if (is_null($limit) || $limit === '') {
            abort(422, "A dataset requires ?limit= (max {$max}).");
        }

        if (! ctype_digit((string) $limit) || (int) $limit < 1) {
            abort(422, '?limit= must be a positive integer.');
        }

        if ((int) $limit > $max) {
            abort(422, "?limit={$limit} exceeds the max allowed for this dataset ({$max}).");
        }

        $offset = $request->query('offset', 0);

        if (! ctype_digit((string) $offset)) {
            abort(422, '?offset= must be a non-negative integer.');
        }

        $query->limit((int) $limit)->offset((int) $offset);
    }
}
