<?php

namespace Vifrost\Laravel\Dataset;

use Illuminate\Database\QueryException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Vifrost\Laravel\QueryBuilder;
use Throwable;

/**
 * The database cancelled a query of a dataset that ran longer than config('vifrost.dataset.timeout_ms').
 */
class DatasetTimeout extends HttpException
{
    /**
     * @param \Throwable|null $previous the database error that reported the cancellation
     */
    public function __construct(?Throwable $previous = null)
    {
        parent::__construct(504, 'The dataset took too long to compute. Narrow it down and try again.', $previous);
    }

    /**
     * Makes an exception handler answer 504 for a query of a dataset the database cancelled,
     * such as the count index() runs before the rows; any other error is left to the handler.
     *
     * @param mixed $handler the app's exception handler
     * @return void
     */
    public static function registerOn($handler): void
    {
        if (! method_exists($handler, 'renderable')) {
            return;
        }

        $handler->renderable(function (QueryException $exception, $request) {
            if (! $request->attributes->get(QueryBuilder::DATASET_ATTRIBUTE) || ! StatementTimeout::isTimeout($exception)) {
                return null;
            }

            $timeout = new static($exception);

            return response()->json(['message' => $timeout->getMessage()], $timeout->getStatusCode());
        });
    }
}
