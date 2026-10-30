<?php

namespace Vifrost\Laravel;

use Exception;
use Illuminate\Support\Facades\File;
use Illuminate\Container\Container;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Pivot;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Vifrost\Laravel\Http\SyncController;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use ReflectionClass;

class Vifrost
{
    /**
     * Path of the models cache file, relative to app()->bootstrapPath() — same
     * convention as Laravel's own bootstrap/cache/{config,routes-v7,packages}.php. Shared between
     * models() (reads it) and the vifrost:cache/vifrost:clear commands (write/delete
     * it), so there's one place to change if it ever needs to move.
     *
     * @var string
     */
    public const MODELS_CACHE_PATH = 'cache/vifrost-models.php';

    /**
     * Find all classes declared of a given type under $rootPath (defaults to app_path()).
     *
     * @param string $className class type to find
     * @param boolean $returnFiles=false indicated if the method should return the files. If false it only return the full class name
     * @param string|null $rootPath directory to scan; defaults to app_path()
     * @return \Illuminate\Support\Collection
     */
    public function findByClass($className, $returnFiles = false, ?string $rootPath = null): Collection
    {
        $rootPath = $rootPath ?? app_path();

        if (! is_dir($rootPath)) {
            return collect();
        }

        $namespaceRoot = app_path();

        $classes = collect(File::allFiles($rootPath))
            ->map(function ($item) use ($namespaceRoot) {
                $path = ltrim(Str::after($item->getPathname(), $namespaceRoot), DIRECTORY_SEPARATOR);
                $class = sprintf(
                    '\%s%s',
                    Container::getInstance()->getNamespace(),
                    strtr(substr($path, 0, strrpos($path, '.')), '/', '\\')
                );

                return $class;
            })
            ->filter(function ($class) use ($className) {
                $valid = false;

                if (class_exists($class)) {
                    $reflection = new ReflectionClass($class);
                    $valid = $reflection->isSubclassOf($className) &&
                        !$reflection->isAbstract();
                }
                return $valid;
            });

        return $returnFiles ? $classes->map(function ($item) {
            return new File((new ReflectionClass($item))->getFileName());
        }) : $classes->values();
    }

    /**
     * Return a collection of all existent models. Scans config('vifrost.models_path')
     * (relative to app_path(), default "Models") unless a cache written by
     * `php artisan vifrost:cache` exists, in which case that's read instead — same
     * opt-in, manually-invalidated model Laravel itself uses for config:cache/
     * route:cache: nothing is cached by default, and it's on the developer to re-run
     * vifrost:cache after adding/removing models, same as after changing .env.
     *
     * @return \Illuminate\Support\Collection
     */
    public function models(): Collection
    {
        $cachePath = app()->bootstrapPath(self::MODELS_CACHE_PATH);

        if (file_exists($cachePath)) {
            return collect(require $cachePath);
        }

        return $this->discoverModels();
    }

    /**
     * Scans config('vifrost.models_path') for models, leaving out the ones
     * config('vifrost.exclude_models') lists and, unless
     * config('vifrost.exclude_pivots') is false, Pivot subclasses.
     *
     * @return \Illuminate\Support\Collection
     */
    public function discoverModels(): Collection
    {
        $models = $this->findByClass(Model::class, false, app_path(config('vifrost.models_path', 'Models')));

        $excluded = array_map(fn ($model) => ltrim($model, '\\'), config('vifrost.exclude_models', []));
        $excludePivots = config('vifrost.exclude_pivots', true);

        return $models->reject(function ($model) use ($excluded, $excludePivots) {
            if (in_array(ltrim($model, '\\'), $excluded)) {
                return true;
            }

            return $excludePivots && is_subclass_of($model, Pivot::class);
        })->values();
    }


    /**
     * Make a query based on the requested route. Only four shapes are supported:
     *   {model}                          -> index, the whole table
     *   {model}/{id}                      -> show, one record
     *   {model}/{id}/{relation}           -> the relation's collection, as the primary resource
     *   {model}/{id}/{relation}/{childId} -> one record within that relation
     *
     * A relation of a relation (e.g. {model}/{id}/{relation}/{childId}/{relation}) is
     * intentionally not supported: that data is already reachable in a single request
     * through Spatie's dotted "include" query param (?include=relation.nested), which
     * doesn't require the URL itself to nest. Anything deeper than one relation hop
     * aborts with 404, as does a relation requested off a record that doesn't exist.
     *
     * This method only resolves and scopes the query — it never applies limit/offset.
     * That's deliberately left to the generated controller (see Controller.stub's
     * index(), which calls Pagination::apply() itself) instead of being hidden inside
     * this package: the controller is the one file a developer actually owns and reads,
     * so pagination should be visible there.
     *
     * @param \Illuminate\Http\Request|null $request request whose path is resolved; defaults to the current request
     * @return \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Eloquent\Relations\Relation
     */
    public function getQuery(?Request $request = null)
    {
        $path = $this->getRequestPath($request);
        if (count($path) > 4) {
            abort(404);
        }

        $rootModel = $this->guessModel($path[0]);
        $query = (new $rootModel)->query();

        if (count($path) === 1) {
            return $query;
        }

        $query = $this->whereKey($query, $query->getModel(), $path[1]);

        if (count($path) === 2) {
            return $query;
        }

        $model = $query->first();
        if (is_null($model)) {
            abort(404);
        }

        $relation = $this->resolveRelation($model, $path[2]);

        if (count($path) === 3) {
            return $relation;
        }

        return $this->whereKey($relation, $relation->getRelated(), $path[3]);
    }

    /**
     * Scopes a query to one record by the primary key of a given model. A composite key is
     * given as its values joined by config('vifrost.composite_key_separator'), in the order of
     * the key columns; a value count that does not match the key aborts with 404.
     *
     * @param \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Eloquent\Relations\Relation $query
     * @param \Illuminate\Database\Eloquent\Model $model model whose primary key scopes the query
     * @param string $key URL segment holding the key value(s)
     * @return \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Eloquent\Relations\Relation
     */
    private function whereKey($query, Model $model, string $key)
    {
        $columns = Describer::primaryKeyColumns($model);

        if (count($columns) === 1) {
            return $query->where($model->qualifyColumn($columns[0]), $key);
        }

        $values = explode(config('vifrost.composite_key_separator', ','), $key);

        if (count($columns) === 0 || count($values) !== count($columns)) {
            abort(404);
        }

        foreach (array_combine($columns, $values) as $column => $value) {
            $query->where($model->qualifyColumn($column), $value);
        }

        return $query;
    }

    /**
     * Retrieves the path sections of the given request, or the current one, without the
     * configured excluded sections
     *
     * @param \Illuminate\Http\Request|null $request defaults to the current request
     * @return array
     */
    public function getRequestPath(?Request $request = null): array
    {
        $sections = explode("/", ($request ?? request())->path());
        return array_values($this->removeExcluded($sections));
    }

    /**
     * Removes the vifrost excluded path sections from a array, ignoring case
     * 
     * @param $path array of request url sections 
     * @return array
     */
    private function removeExcluded(array $path)
    {
        $excluded = array_map('strtolower', config('vifrost.exclude'));
        return array_filter($path, function ($subSection) use ($excluded) {
            return ! in_array(strtolower($subSection), $excluded);
        });
    }

    /**
     * Guess the model based on a string with the model name
     *
     * @param string $name URL segment naming the model, matched case-insensitively
     * @return string matched model full class name
     */
    private function guessModel($name)
    {
        $match = $this->findModel($name);
        if (is_null($match)) {
            throw new Exception("Could not find a matching model for $name", 404);
        }
        return $match;
    }

    /**
     * Finds the exposed model whose class basename matches a URL segment
     *
     * @param string $name URL segment naming the model, matched case-insensitively
     * @return string|null matched model full class name
     */
    public function findModel(string $name): ?string
    {
        foreach ($this->models() as $model) {
            $exploded = explode("\\", $model);
            if (strtolower(end($exploded)) === strtolower($name)) {
                return $model;
            }
        }
        return null;
    }

    /**
     * Registers the sync endpoint at config('vifrost.sync_route.path'), with
     * config('vifrost.sync_route.middleware'). The service provider calls it when
     * config('vifrost.sync_route.enabled') is true; call it from a route group of your
     * own instead (e.g. with a domain or extra middleware) and leave that option false.
     *
     * @return \Illuminate\Routing\Route
     */
    public static function syncRoute()
    {
        return Route::post(config('vifrost.sync_route.path', 'api/_vifrost/sync'), SyncController::class)
            ->middleware(config('vifrost.sync_route.middleware', ['api']));
    }

    /**
     * Class name of the controller vifrost:api generates for a model
     *
     * @param string $modelClass model full classname
     * @return string
     */
    public static function controllerFor(string $modelClass): string
    {
        return 'App\\Http\\Controllers\\' . class_basename($modelClass) . 'Controller';
    }

    /**
     * Resolves a relation for a given subject
     * 
     * @param \Illuminate\Database\Eloquent\Model $subject where the relation is searched
     * @param string $relation method name for the relation
     * @return \Illuminate\Database\Eloquent\Builder;
     */
    private function resolveRelation(Model $subject, string $relation)
    {
        if (method_exists($subject, $relation)) {
            return $subject->$relation();
        }
        $plural = Str::plural($relation);
        if (method_exists($subject, $plural)) {
            return $subject->$plural();
        }
        $singular = Str::singular($relation);
        if (method_exists($subject, $singular)) {
            return $subject->$singular();
        }
        abort(404);
    }
}
