<?php

use Vifrost\Laravel\Describer;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

beforeEach(function () {
    foreach (['dental_findings', 'patients', 'people', 'appointments', 'boxes', 'clinics'] as $table) {
        Schema::dropIfExists($table);
    }

    Schema::create('clinics', function (Blueprint $table) {
        $table->id();
    });

    Schema::create('boxes', function (Blueprint $table) {
        $table->id();
        $table->foreignId('clinic_id')->constrained();
        $table->unique(['clinic_id', 'id']);
    });

    Schema::create('appointments', function (Blueprint $table) {
        $table->id();
        $table->foreignId('clinic_id')->constrained();
        $table->foreignId('box_id');
        $table->foreign(['clinic_id', 'box_id'])->references(['clinic_id', 'id'])->on('boxes');
    });

    Schema::create('people', function (Blueprint $table) {
        $table->id();
    });

    Schema::create('patients', function (Blueprint $table) {
        $table->id();
        $table->foreignId('clinic_id')->constrained();
        $table->foreignId('person_id')->constrained('people');
        $table->unique(['clinic_id', 'person_id']);
    });

    Schema::create('dental_findings', function (Blueprint $table) {
        $table->id();
        $table->foreignId('clinic_id')->constrained();
        $table->foreign(['clinic_id', 'person_id'])->references(['clinic_id', 'person_id'])->on('patients');
        $table->foreignId('person_id')->constrained('people');
    });
});

it('uses the referenced column at the same position as the local column of a composite key', function () {
    $foreign = Describer::getForeignKeysFor(DB::getDefaultConnection(), 'appointments', 'box_id');

    expect($foreign->foreignTable)->toBe('boxes')
        ->and($foreign->foreignColumn)->toBe('id');
});

it('prefers a single-column foreign key over a composite one that also contains the column', function () {
    $connection = DB::getDefaultConnection();

    expect(Describer::getForeignKeysFor($connection, 'dental_findings', 'person_id'))
        ->foreignTable->toBe('people')
        ->foreignColumn->toBe('id')
        ->and(Describer::getForeignKeysFor($connection, 'appointments', 'clinic_id'))
        ->foreignTable->toBe('clinics')
        ->foreignColumn->toBe('id');
});
