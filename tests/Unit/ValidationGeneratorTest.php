<?php

use Vifrost\Laravel\FormRequest\ValidationGenerator;

function columnRules(array $overrides): string
{
    return (new ValidationGenerator)->generate(array_merge([
        'type' => 'varchar',
        'rawType' => 'varchar(255)',
        'isNullable' => false,
        'length' => null,
        'hasDefaultValue' => false,
        'hasAutoIncrement' => false,
        'isForeign' => false,
        'foreign' => null,
    ], $overrides));
}

it('adds nullable to nullable columns so null can clear them', function () {
    expect(columnRules(['type' => 'text', 'rawType' => 'text', 'isNullable' => true]))->toBe('nullable|string')
        ->and(columnRules(['type' => 'text', 'rawType' => 'text']))->toBe('required|string');
});

it('accepts ISO 8601 dates for datetime, timestamp and timestamptz columns', function (string $type) {
    expect(columnRules(['type' => $type, 'rawType' => $type]))->toBe('required|date');
})->with(['datetime', 'timestamp', 'timestamptz']);

it('accepts times with and without seconds for time and timetz columns', function (string $type) {
    expect(columnRules(['type' => $type, 'rawType' => $type]))->toBe('required|date_format:H:i,H:i:s');
})->with(['time', 'timetz']);

it('expects arrays for json and jsonb columns, which is what the client sends', function (string $type) {
    expect(columnRules(['type' => $type, 'rawType' => $type]))->toBe('required|array');
})->with(['json', 'jsonb']);

it('treats Postgres bpchar like char', function () {
    expect(columnRules(['type' => 'bpchar', 'rawType' => 'character(2)', 'length' => 2]))->toBe('required|string|max:2');
});

it('checks a foreign key against the referenced column the Describer resolved', function () {
    $foreign = (object) [
        'localColumn' => ['clinic_id', 'box_id'],
        'foreignTable' => 'boxes',
        'foreignColumnName' => ['clinic_id', 'id'],
        'foreignColumn' => 'id',
    ];

    expect(columnRules(['type' => 'int8', 'rawType' => 'bigint', 'isForeign' => true, 'foreign' => $foreign]))
        ->toBe('required|integer|exists:boxes,id');
});
