<?php

namespace Vifrost\Laravel\Tests\Fixtures\SyncModels;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Exists only for SyncControllerTest.
 */
class Board extends Model
{
    protected $table = 'boards';
    protected $guarded = [];
    public $timestamps = false;

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function tickets(): HasMany
    {
        return $this->hasMany(Ticket::class);
    }
}
