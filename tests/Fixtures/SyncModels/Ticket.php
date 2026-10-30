<?php

namespace Vifrost\Laravel\Tests\Fixtures\SyncModels;

use Illuminate\Database\Eloquent\Model;

/**
 * Exists only for SyncControllerTest.
 */
class Ticket extends Model
{
    protected $table = 'tickets';
    protected $guarded = [];
    public $timestamps = false;
}
