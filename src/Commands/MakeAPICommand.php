<?php

namespace Vifrost\Laravel\Commands;

use Vifrost\Laravel\Vifrost;
use Vifrost\Laravel\Mapper;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class MakeAPICommand extends Command
{
    /**
     * Colelction of working models
     * 
     * @var \Illuminate\Support\Collection
     */
    protected $models;

    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'vifrost:api {model=all} {--force : Append route blocks even for a model routes/api.php already references, without asking}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Creates routes, request and controller for a given model';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        $this->models = (new Vifrost)->models();
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $models = $this->getModels();

        $path = base_path('routes/api.php');

        $this->ensureApiRoutesFile($path);
        $this->ensureApiRoutingRegistered(base_path('bootstrap/app.php'));

        $existingRoutes = file_get_contents($path);

        $routedModels = array_map(fn ($model) => ltrim($model, '\\'), collect($models)->all());

        foreach ($models as $model) {
            $exploded = explode('\\',  $model);

            $shortName = end($exploded);

            Artisan::call("vifrost:request Store{$shortName}Request {$shortName}");

            Artisan::call("vifrost:request Update{$shortName}Request {$shortName}");

            Artisan::call("vifrost:controller {$shortName}");

            if ($this->routesAlreadyExist($shortName, $existingRoutes) && !$this->shouldOverwriteRoutes($shortName, $path)) {
                continue;
            }

            $routeSubPath = strtolower($shortName);

            $routes = $this->buildFlatRoutes($shortName, $routeSubPath);
            $routes .= $this->buildNestedRoutes($model, $routeSubPath, $routedModels);

            file_put_contents($path, $routes,  FILE_APPEND | LOCK_EX);
            $existingRoutes .= $routes;
        }

        return 0;
    }

    /**
     * Whether routes/api.php already registers this model's flat CRUD group
     * — the `Route::controller(...)` block {@see buildFlatRoutes} would
     * otherwise append a second time. Detected by that block's opening line
     * alone, not by diffing exact route lines: good enough to flag "this
     * model was routed before" without parsing routes/api.php as PHP, and
     * routes/api.php is meant to evolve by hand after the initial generation
     * (auth, middleware, a removed verb, ...) — not be kept in sync on every
     * regeneration.
     *
     * @param string $shortName model class basename, e.g. "Product"
     * @param string $existingContent current routes/api.php contents
     * @return bool
     */
    protected function routesAlreadyExist(string $shortName, string $existingContent): bool
    {
        return str_contains($existingContent, "Route::controller( '\\App\\Http\\Controllers\\{$shortName}Controller' )");
    }

    /**
     * Asks before appending a possibly-duplicate route block for a model
     * routes/api.php already references, since blindly re-appending would
     * silently sit alongside (and, depending on the exact patterns, shadow or
     * be shadowed by) whatever the developer already changed by hand.
     * `--force` skips the prompt — e.g. for CI, or a deliberate re-run.
     *
     * @param string $shortName model class basename, e.g. "Product"
     * @param string $path routes/api.php absolute path, only for the message
     * @return bool
     */
    protected function shouldOverwriteRoutes(string $shortName, string $path): bool
    {
        if ($this->option('force')) {
            return true;
        }

        $this->components->warn("Routes for {$shortName} already appear to exist in {$path}.");

        return $this->confirm(
            "Append a new {$shortName} route block anyway? This may duplicate or conflict with routes you've since customized.",
            false
        );
    }

    /**
     * Ensures api routes file exists and has php tag
     *
     * @param string $path routes/api.php absolute path
     * @return void
     */
    protected function ensureApiRoutesFile(string $path): void
    {
        if (file_exists($path)) {
            return;
        }

        file_put_contents(
            $path,
            "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n",
            LOCK_EX
        );
    }

    /**
     * Ensures api routes are registered
     *
     * @param string $path bootstrap/app.php absolute path
     * @return void
     */
    protected function ensureApiRoutingRegistered(string $path): void
    {
        if (!file_exists($path)) {
            return;
        }

        $content = file_get_contents($path);

        if (str_contains($content, 'api:')) {
            return;
        }

        $webRoutingLine = "web: __DIR__.'/../routes/web.php',";

        if (!str_contains($content, $webRoutingLine)) {
            $this->components->warn("Could not automatically register routes/api.php in [{$path}] — register it manually via withRouting(api: ...).");

            return;
        }

        file_put_contents(
            $path,
            str_replace(
                $webRoutingLine,
                $webRoutingLine . PHP_EOL . "        api: __DIR__.'/../routes/api.php',",
                $content
            ),
            LOCK_EX
        );
    }

    /**
     * Flat CRUD routes for a model's own resource.
     *
     * @param string $shortName model class basename, e.g. "Product"
     * @param string $routeSubPath lowercased model name used as the URL segment
     * @return string
     */
    protected function buildFlatRoutes(string $shortName, string $routeSubPath): string
    {
        return "\n\nRoute::controller( '\\App\\Http\\Controllers\\{$shortName}Controller' )->group( function(){\n"
            . "    Route::get('{$routeSubPath}' , 'index' );\n"
            . "    Route::get('{$routeSubPath}/{id}' , 'show');\n"
            . "    Route::post('{$routeSubPath}', 'store');\n"
            . "    Route::put('{$routeSubPath}/{id}', 'update');\n"
            . "    Route::delete('{$routeSubPath}/{id}', 'destroy');\n"
            . "});";
    }

    /**
     * Read-only routes for each of the model's relations, exactly one hop deep: the
     * related model's own controller serves them, scoped by the parent's id (see
     * Vifrost::getQuery()). A relation of a relation isn't routed here at all —
     * that data is reachable in a single request via Spatie's dotted "include" query
     * param instead. MorphTo relations are skipped: they have no single fixed related
     * model to route to. So are relations to a model that will not have a controller:
     * one Vifrost does not expose (see the exclude_models config), or one whose
     * controller neither exists yet nor is generated in this same run.
     *
     * @param string $model model full classname
     * @param string $routeSubPath lowercased model name used as the URL segment
     * @param array $routedModels full classnames, without leading backslash, of the models generated in this run
     * @return string
     */
    protected function buildNestedRoutes(string $model, string $routeSubPath, array $routedModels = []): string
    {
        $relations = (new Mapper([$model]))->getRelationshipMap()[$model] ?? [];
        $routes = '';

        foreach ($relations as $relation) {
            $related = $relation->getRelated();
            if (is_null($related)) {
                continue;
            }

            $relatedExploded = explode('\\', $related);
            $relatedShortName = end($relatedExploded);
            $relationName = $relation->getRelationName();

            if (! $this->willHaveController($related, $relatedShortName, $routedModels)) {
                continue;
            }

            $routes .= "\nRoute::get('{$routeSubPath}/{id}/{$relationName}', [\\App\\Http\\Controllers\\{$relatedShortName}Controller::class, 'index']);";
            $routes .= "\nRoute::get('{$routeSubPath}/{id}/{$relationName}/{childId}', [\\App\\Http\\Controllers\\{$relatedShortName}Controller::class, 'show']);";
        }

        return $routes;
    }

    /**
     * Whether a related model is exposed by Vifrost and its controller exists or is generated in this run
     *
     * @param string $related related model full classname
     * @param string $relatedShortName related model class basename
     * @param array $routedModels full classnames, without leading backslash, of the models generated in this run
     * @return bool
     */
    protected function willHaveController(string $related, string $relatedShortName, array $routedModels): bool
    {
        $related = ltrim($related, '\\');
        $exposed = collect($this->models)->contains(fn ($model) => ltrim($model, '\\') === $related);

        if (! $exposed) {
            return false;
        }

        return in_array($related, $routedModels)
            || file_exists(app_path("Http/Controllers/{$relatedShortName}Controller.php"));
    }

    public function getModels()
    {
        $input = $this->argument('model');
        return $input == 'all' ? $this->models : ["\\App\\Models\\$input"];
    }
}
