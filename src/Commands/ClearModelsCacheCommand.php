<?php

namespace Vifrost\Laravel\Commands;

use Vifrost\Laravel\Vifrost;
use Illuminate\Console\Command;

class ClearModelsCacheCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'vifrost:clear';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Remove the cached Vifrost models file, restoring the live filesystem scan';

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $path = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);

        if (! file_exists($path)) {
            $this->info('No Vifrost models cache to remove.');

            return 0;
        }

        unlink($path);

        $this->info("Removed {$path}");

        return 0;
    }
}
