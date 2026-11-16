<?php

namespace Vifrost\Laravel\Tests\Fixtures\DatasetModels;

use Illuminate\Database\Eloquent\Model;

/**
 * Exists only for DatasetTest.
 */
class Refund extends Model
{
    protected $table = 'ds_refunds';
    protected $guarded = [];
    public $timestamps = false;
}
