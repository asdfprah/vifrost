<?php

namespace Vifrost\Laravel\Http;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Vifrost\Laravel\Describer;
use Vifrost\Laravel\Pagination;
use Vifrost\Laravel\Vifrost;

/**
 * Refreshes several collection queries of a client in one request, so it can keep its
 * lists in sync when records are created, updated or deleted. Each query runs through
 * the query() method of the generated controller that serves it, with a request built
 * from the client's query string; no request is dispatched, so the route middleware of
 * each query does not run and this endpoint's own middleware guards them all.
 */
class SyncController
{
    /**
     * Runs each query and returns, per query, its status, the primary keys of the
     * current page in order, the total row count, and the rows the client does not
     * have yet.
     *
     * @param \Illuminate\Http\Request $request body: { queries: [{ path, known }] }
     * @return \Illuminate\Http\JsonResponse
     */
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'queries' => 'required|array|max:' . config('vifrost.sync_route.max_queries', 20),
            'queries.*.path' => 'required|string',
            'queries.*.known' => 'array',
        ]);

        $results = array_map(
            fn ($query) => $this->sync($query['path'], $this->normalizeKeys($query['known'] ?? [])),
            $request->input('queries')
        );

        return response()->json(['results' => $results]);
    }

    /**
     * Refreshes one query, turning an HTTP error it raises into its status instead of
     * failing the whole batch
     *
     * @param string $path query path relative to the API root, with its query string
     * @param array $known normalized keys of the rows the client already has
     * @return array
     */
    private function sync(string $path, array $known): array
    {
        $queryRequest = Request::create('/' . ltrim($path, '/'), 'GET');

        try {
            return $this->run($queryRequest, $known);
        } catch (HttpExceptionInterface $exception) {
            return ['status' => $exception->getStatusCode()];
        } catch (ModelNotFoundException) {
            return ['status' => 404];
        }
    }

    /**
     * Runs a collection query through its controller's query() method and paginates it
     * like index() does
     *
     * @param \Illuminate\Http\Request $queryRequest request built from the query path
     * @param array $known normalized keys of the rows the client already has
     * @return array
     */
    private function run(Request $queryRequest, array $known): array
    {
        $vifrost = new Vifrost;
        $sections = $vifrost->getRequestPath($queryRequest);

        if (! in_array(count($sections), [1, 3]) || is_null($vifrost->findModel($sections[0]))) {
            return ['status' => 404];
        }

        $modelClass = $this->servedModel($vifrost->getQuery($queryRequest));
        $controllerClass = Vifrost::controllerFor($modelClass);

        if (! class_exists($controllerClass) || ! method_exists($controllerClass, 'query')) {
            return ['status' => 501];
        }

        $query = app($controllerClass)->query($queryRequest);
        $total = $query->toBase()->getCountForPagination();
        Pagination::apply($query, $modelClass, $queryRequest);
        $rows = $query->get();

        $keyColumns = Describer::primaryKeyColumns(new $modelClass);
        $ids = $rows->map(fn (Model $row) => $this->keyOf($row, $keyColumns))->all();

        $missing = $rows->reject(
            fn (Model $row) => in_array($this->normalizeKey($this->keyOf($row, $keyColumns)), $known)
        );

        return [
            'status' => 200,
            'ids' => $ids,
            'total' => $total,
            'rows' => $missing->values(),
        ];
    }

    /**
     * The model class whose controller serves a resolved query: the related model of a
     * nested relation, or the root model otherwise
     *
     * @param \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Eloquent\Relations\Relation $query
     * @return string
     */
    private function servedModel($query): string
    {
        return $query instanceof Relation ? get_class($query->getRelated()) : get_class($query->getModel());
    }

    /**
     * The primary key of a row: its value, or the list of values of a composite key
     *
     * @param \Illuminate\Database\Eloquent\Model $row
     * @param array $keyColumns primary key columns of the row's model
     * @return mixed
     */
    private function keyOf(Model $row, array $keyColumns)
    {
        $values = array_map(fn ($column) => $row->getAttribute($column), $keyColumns);
        return count($values) === 1 ? $values[0] : $values;
    }

    /**
     * Normalizes a list of keys sent by the client so they compare equal to the keys of
     * the rows
     *
     * @param array $keys simple key values, or lists of composite key values
     * @return array
     */
    private function normalizeKeys(array $keys): array
    {
        return array_map(fn ($key) => $this->normalizeKey($key), $keys);
    }

    /**
     * Turns a simple or composite key into a comparable string
     *
     * @param mixed $key
     * @return string
     */
    private function normalizeKey($key): string
    {
        return json_encode(array_map('strval', (array) $key));
    }
}
