<?php

namespace Vifrost\Laravel\Tests\Fixtures\DatasetModels;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Exists only for DatasetTest.
 */
class Customer extends Model
{
    protected $table = 'ds_customers';
    protected $guarded = [];
    protected $hidden = ['api_token'];
    public $timestamps = false;

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
