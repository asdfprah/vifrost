<?php

namespace Vifrost\Laravel\Dataset;

use Spatie\QueryBuilder\Exceptions\InvalidQuery;
use Symfony\Component\HttpFoundation\Response;

/**
 * A dataset request asks for something its model's query() does not allow, or is malformed.
 */
class InvalidDatasetQuery extends InvalidQuery
{
    /**
     * @param string $message
     */
    public function __construct(string $message)
    {
        parent::__construct(Response::HTTP_BAD_REQUEST, $message);
    }

    /**
     * @param string $model model full classname
     * @return static
     */
    public static function notEnabled(string $model): static
    {
        return new static('Datasets are not enabled for ' . class_basename($model) . '.');
    }

    /**
     * @param string $part what is not allowed, e.g. "Column", "Join"
     * @param string $name the requested name
     * @param array $allowed the names allowed instead
     * @return static
     */
    public static function notAllowed(string $part, string $name, array $allowed): static
    {
        $allowedList = empty($allowed) ? 'none' : implode(', ', $allowed);

        return new static("{$part} `{$name}` is not allowed. Allowed: {$allowedList}.");
    }

    /**
     * @param string $message
     * @return static
     */
    public static function malformed(string $message): static
    {
        return new static($message);
    }
}
