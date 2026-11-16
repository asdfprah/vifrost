<?php

namespace Vifrost\Laravel\Broadcasting;

use Illuminate\Database\Eloquent\BroadcastsEvents;
use Vifrost\Laravel\Describer;

/**
 * Broadcasts a model's created, updated, deleted, trashed and restored events the way
 * @vifrost/client's listenToModelBroadcasts() reads them: named "{Model}{Event}" (e.g.
 * "ProductUpdated") and carrying only the record's key, so clients reload the record through
 * the API, which applies authorization. The model defines broadcastOn($event) with the channels
 * to broadcast on, as with Eloquent's own BroadcastsEvents.
 */
trait BroadcastsVifrostEvents
{
    use BroadcastsEvents;

    /**
     * The payload of a model event: the record's key, or every column of a composite key.
     *
     * @param string $event
     * @return array
     */
    public function broadcastWith($event): array
    {
        return ['model' => $this->only(Describer::primaryKeyColumns($this))];
    }
}
