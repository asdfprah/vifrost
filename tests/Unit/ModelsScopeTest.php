<?php

use Vifrost\Laravel\Vifrost;
use Illuminate\Support\Facades\Artisan;

describe('ModelsScopeTest', function () {
    it('scopes the scan to config(vifrost.models_path) instead of the whole app_path()', function () {
        config(['vifrost.models_path' => 'ScopedModels']);

        $models = (new Vifrost)->models();

        expect($models->map(fn($m) => class_basename($m))->all())->toBe(['DummyScopedModel']);
    });

    it('returns an empty collection instead of throwing when the configured models_path does not exist', function () {
        config(['vifrost.models_path' => 'NoSuchDirectory']);

        expect((new Vifrost)->models())->toBeEmpty();
    });

    it('reads from the models cache file instead of scanning, when vifrost:cache wrote one', function () {
        $cachePath = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);
        @mkdir(dirname($cachePath), 0777, true);
        file_put_contents($cachePath, "<?php\nreturn ['\\\\Some\\\\Cached\\\\Model'];\n");

        try {
            $models = (new Vifrost)->models();
        } finally {
            @unlink($cachePath);
        }

        expect($models->all())->toBe(['\Some\Cached\Model']);
    });

    it('vifrost:cache writes a working cache file that vifrost:clear removes', function () {
        config(['vifrost.models_path' => 'ScopedModels']);
        $cachePath = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);
        @unlink($cachePath);

        try {
            Artisan::call('vifrost:cache');

            expect(file_exists($cachePath))->toBeTrue();
            expect(collect(require $cachePath)->map(fn($m) => class_basename($m))->all())
                ->toBe(['DummyScopedModel']);

            config(['vifrost.models_path' => 'NoSuchDirectory']);
            expect((new Vifrost)->models())->not->toBeEmpty();

            Artisan::call('vifrost:clear');

            expect(file_exists($cachePath))->toBeFalse();
        } finally {
            @unlink($cachePath);
        }
    });
});
