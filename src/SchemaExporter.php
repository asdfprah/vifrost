<?php

namespace Vifrost\Laravel;

class SchemaExporter{

    /**
     * Bump whenever the JSON shape returned by build() changes in a way that isn't
     * purely additive (renamed/removed/restructured keys). External codegen tooling
     * (the npm adapter generators) reads this to detect a contract change instead of
     * failing on an unrecognized shape.
     */
    const SCHEMA_VERSION = 1;

    /**
     * Build a JSON-serializable map of models — their table, primary key, column
     * attributes (as reported by Describer) and relations (as reported by Mapper).
     * Meant to be consumed by external tooling that generates typed Coloquent /
     * vue-api-query model adapters from it.
     *
     * @param array|null $models defaults to every model Vifrost can find in the app
     * @return array
     */
    public static function build(?array $models = null):array{
        $models = $models ?? (new Vifrost)->models()->all();

        $relationshipMap = (new Mapper($models))->getRelationshipMap();

        $schema = [];
        foreach ($models as $model) {
            $instance = new $model;
            // Vifrost::models() returns FQCNs with a leading backslash, but
            // Relation::getRelated() (get_class() under the hood) never includes
            // one — normalize both to the same (backslash-less) form so a
            // relation's "related" value always matches one of this JSON's own
            // model keys, letting external tooling join them reliably.
            $schema[ltrim($model, '\\')] = [
                'table' => $instance->getTable(),
                'primaryKey' => self::primaryKeyFor($instance),
                // The actual URL segment Vifrost routes this model under (see
                // MakeAPICommand::handle()) — NOT the same as the DB table name,
                // which is typically pluralized/snake_case while this is the
                // lowercased singular model class name.
                'resource' => self::resourceFor($model),
                'maxLimit' => Pagination::maxLimitFor($model),
                'attributes' => self::attributesFor($instance),
                'relations' => self::relationsFor($relationshipMap[$model] ?? []),
            ];
        }

        return [
            'schemaVersion' => self::SCHEMA_VERSION,
            'compositeKeySeparator' => config('vifrost.composite_key_separator', ','),
            'models' => $schema,
        ];
    }

    /**
     * The primary key column name, the list of column names of a composite key, or null for a
     * table without a primary key.
     *
     * @param \Illuminate\Database\Eloquent\Model $instance
     * @return string|array|null
     */
    private static function primaryKeyFor($instance){
        $columns = Describer::primaryKeyColumns($instance);
        return match (count($columns)) {
            0 => null,
            1 => $columns[0],
            default => $columns,
        };
    }

    /**
     * @param string $model model full classname
     * @return string
     */
    private static function resourceFor(string $model):string{
        $exploded = explode('\\', $model);
        return strtolower(end($exploded));
    }

    /**
     * @param \Illuminate\Database\Eloquent\Model $instance
     * @return array
     */
    private static function attributesFor($instance):array{
        $attributes = [];
        foreach (Describer::describe($instance) as $column => $description) {
            $attributes[$column] = [
                'type' => $description['type'],
                'rawType' => $description['rawType'],
                'length' => $description['length'],
                'isNullable' => $description['isNullable'],
                'isPrimaryKey' => $description['isPrimaryKey'],
                'hasAutoIncrement' => $description['hasAutoIncrement'],
                'hasDefaultValue' => $description['hasDefaultValue'],
                'defaultValue' => $description['defaultValue'],
                'isForeign' => $description['isForeign'],
                'foreign' => self::foreignFor($description['foreign']),
            ];
        }
        return $attributes;
    }

    /**
     * @param \stdClass|null $foreign as returned by Describer::getForeignKeysFor()
     * @return array|null
     */
    private static function foreignFor($foreign){
        if(is_null($foreign)){
            return null;
        }
        return [
            'table' => $foreign->foreignTable,
            'column' => $foreign->foreignColumn,
        ];
    }

    /**
     * @param \Vifrost\Laravel\Relation[] $relations
     * @return array
     */
    private static function relationsFor(array $relations):array{
        $result = [];
        foreach ($relations as $relation) {
            // MorphTo has no single fixed related model — it's resolved per-row from
            // the "*_type" column — so getRelated() is null; flag it explicitly rather
            // than let the adapter mistake the missing value for a mapping gap.
            $result[$relation->getRelationName()] = [
                'type' => $relation->getRelationType(),
                'related' => $relation->getRelated(),
                'polymorphic' => is_null($relation->getRelated()),
            ];
        }
        return $result;
    }
}
