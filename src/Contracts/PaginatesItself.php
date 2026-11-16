<?php

namespace Vifrost\Laravel\Contracts;

use Illuminate\Http\Request;

/**
 * A query that may follow its own pagination rules instead of the ones Pagination applies to
 * a list of records.
 */
interface PaginatesItself
{
    /**
     * Applies this query's own limit and offset for a request, when it has its own rules.
     *
     * @param string $modelClass model full classname
     * @param \Illuminate\Http\Request $request
     * @return bool whether it paginated itself; when false, Pagination applies its rules
     */
    public function applyOwnPagination(string $modelClass, Request $request): bool;
}
