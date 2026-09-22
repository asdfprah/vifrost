<?php

namespace Vifrost\Laravel\Providers;

use Vifrost\Laravel\Commands\CacheModelsCommand;
use Vifrost\Laravel\Commands\ClearModelsCacheCommand;
use Vifrost\Laravel\Commands\MakeAPICommand;
use Vifrost\Laravel\Commands\MakeControllerCommand;
use Vifrost\Laravel\Commands\MakeRequestCommand;
use Vifrost\Laravel\Commands\SchemaCommand;
use Vifrost\Laravel\SchemaExporter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;


class VifrostServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     *
     * @return void
     */
    public function register()
    {
        $this->mergeConfigFrom(
            $this->getSrcPath().'/Config/Vifrost.php', 'vifrost'
        );
    }

    /**
     * Bootstrap services.
     *
     * @return void
     */
    public function boot()
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                MakeRequestCommand::class,
                MakeControllerCommand::class,
                MakeAPICommand::class,
                SchemaCommand::class,
                CacheModelsCommand::class,
                ClearModelsCacheCommand::class,
            ]);
        }

        if (config('vifrost.expose_schema_route')) {
            Route::get(config('vifrost.schema_route_path', 'api/_schema'), function () {
                return response()->json(SchemaExporter::build());
            });
        }

        $srcPath = $this->getSrcPath();
        $this->publishes([
            $srcPath.'/Config/Vifrost.php' => $this->configPath('vifrost.php')
        ], 'config');
    }

    private function getSrcPath(){
        return dirname( dirname(__FILE__) );
    }

    private function configPath($path = '')
    {
        return app()->basePath() . '/config' . ($path ? '/' . $path : $path);
    }
}
