<?php

namespace Vifrost\Laravel\Commands;

use Vifrost\Laravel\Vifrost;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\File;

class CacheModelsCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'vifrost:cache';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Cache the models Vifrost discovers, skipping the filesystem scan until vifrost:clear is run';

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $models = (new Vifrost)->findByClass(
            Model::class,
            false,
            app_path(config('vifrost.models_path', 'Models'))
        );

        $path = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);

        File::ensureDirectoryExists(dirname($path));

        file_put_contents(
            $path,
            '<?php'.PHP_EOL.PHP_EOL.'return '.var_export($models->values()->all(), true).';'.PHP_EOL
        );

        $this->info("Cached {$models->count()} model(s) to {$path}");

        return 0;
    }
}
