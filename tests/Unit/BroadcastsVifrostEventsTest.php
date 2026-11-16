<?php

use Illuminate\Database\Eloquent\BroadcastableModelEventOccurred;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Vifrost\Laravel\Broadcasting\BroadcastsVifrostEvents;

/**
 * A model broadcasting the way the client expects.
 */
class BroadcastProduct extends Model
{
    use BroadcastsVifrostEvents;

    protected $table = 'broadcast_products';
    protected $guarded = [];
}

/**
 * A model with a composite key broadcasting the way the client expects.
 */
class BroadcastProductTag extends Model
{
    use BroadcastsVifrostEvents;

    protected $table = 'broadcast_product_tags';
    protected $primaryKey = null;
    public $incrementing = false;
    protected $guarded = [];
}

beforeEach(function () {
    Schema::dropIfExists('broadcast_product_tags');
    Schema::create('broadcast_product_tags', function (Blueprint $table) {
        $table->unsignedBigInteger('product_id');
        $table->unsignedBigInteger('tag_id');
        $table->string('weight');
        $table->primary(['product_id', 'tag_id']);
    });
});

it('names model events by model and event and sends only the key', function () {
    $event = new BroadcastableModelEventOccurred(new BroadcastProduct(['id' => 5, 'name' => 'Lamp', 'sku' => 'L-1']), 'updated');

    expect($event->broadcastAs())->toBe('BroadcastProductUpdated')
        ->and($event->broadcastWith())->toBe(['model' => ['id' => 5]]);
});

it('sends every column of a composite key', function () {
    $model = new BroadcastProductTag(['product_id' => 5, 'tag_id' => 3, 'weight' => '10']);

    expect((new BroadcastableModelEventOccurred($model, 'trashed'))->broadcastWith())
        ->toBe(['model' => ['product_id' => 5, 'tag_id' => 3]]);
});
