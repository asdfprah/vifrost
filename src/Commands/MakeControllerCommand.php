<?php

namespace Vifrost\Laravel\Commands;

use Vifrost\Laravel\Commands\VifrostCommand;
use Vifrost\Laravel\Describer;
use Vifrost\Laravel\Mapper;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;

class MakeControllerCommand extends VifrostCommand
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'vifrost:controller {model} {--force}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Creates a new Controller';


    /**
	 * The type of class being generated.
	 *
	 * @var string
	 */
    protected $type = 'Controller';

    /**
     * Indicates whether the command should be shown in the Artisan command list.
     *
     * @var bool
     */
    protected $hidden = true;

    protected function getCodeToReplace(){
        $model = $this->argument("model");
        $includes = $this->getIncludes( $this->getModel() );
        return [
            "model" => $model,
            "includes" => $includes,
            "keys" => implode(', ', array_map(fn ($column) => "'{$column}'", $this->getKeyColumns())),
        ];
    }

    protected function getIncludes($model){
        $model = str_starts_with($model ,'\\') ? $model : '\\'.$model;
        $mapper = new Mapper( [ $model ] );
        $relations = ($mapper->getRelationshipMap())[$model];
        $relationsName = array_map(function($r){
            return $r->getRelationName();
        }, $relations);
        $relationsName = array_unique( $relationsName );
        $includes = "";
        foreach ($relationsName as $relation) {
            $includes = $includes ."'". $relation. "',\n                ";
        }
        return $includes;
    }

	/**
	 * Get the stub file for the generator.
	 *
	 * @return string
	 */
	protected function getStub()
	{
		$stub = count($this->getKeyColumns()) > 1 ? 'Controller.composite.stub' : 'Controller.stub';
		return  dirname( dirname(__FILE__) ).'/Stubs/'.$stub;
	}

    /**
     * Primary key columns of the model the controller is generated for
     *
     * @return array
     */
    protected function getKeyColumns(): array
    {
        $model = $this->getModel();
        return Describer::primaryKeyColumns(new $model);
    }

	/**
	 * Get the default namespace for the class.
	 *
	 * @param  string  $rootNamespace
	 * @return string
	 */
	protected function getDefaultNamespace($rootNamespace)
	{
		return $rootNamespace . '\Http\Controllers';
	}

    protected function getModel(){
        $modelName = $this->argument("model");
        return "App\\Models\\".$modelName;   
    }

    protected function getNameInput()
    {
        $model = $this->getModel();
        return "{$model}Controller";
    }

    /**
     * Get the console command arguments.
     *
     * @return array
     */
    protected function getArguments()
    {
        return [
            ['model', InputArgument::REQUIRED, 'The name to generate request.'],
        ];
    }

    /**
     * Get the console command options.
     *
     * @return array
     */
    protected function getOptions()
    {
        return [
            ['force', null, InputOption::VALUE_NONE, 'Create the abstract class even if it already exists'],
        ];
    }

    /**
     * Execute the console command.
     *
     * @return bool|null
     *
     * @throws \Illuminate\Contracts\Filesystem\FileNotFoundException
     */
    public function handle()
    {
        // First we need to ensure that the given name is not a reserved word within the PHP
        // language and that the class name will actually be valid. If it is not valid we
        // can error now and prevent from polluting the filesystem using invalid files.
        if ($this->isReservedName($this->getNameInput())) {
            $this->error('The name "'.$this->getNameInput().'" is reserved by PHP.');

            return false;
        }
        $model = $this->argument("model");
        $name =  "\\App\\Http\\Controllers\\{$model}Controller";
        $path = $this->getPath( "Http\\Controllers\\{$model}Controller" ) ;
        $this->info($path);
        // Next, We will check to see if the class already exists. If it does, we don't want
        // to create the class and overwrite the user's code. So, we will bail out so the
        // code is untouched. Otherwise, we will continue generating this class' files.
        if ((! $this->hasOption('force') ||
             ! $this->option('force')) &&
             $this->alreadyExists($this->getNameInput())) {
            $this->error($this->type.' already exists!');

            return false;
        }

        // Next, we will generate the path to the location where this class' file should get
        // written. Then, we will build the class and make the proper replacements on the
        // stub files so that it gets the correctly formatted namespace and class name.
        $this->makeDirectory($path);

        $this->files->put($path, $this->sortImports($this->buildClass($name)));

        $this->info($this->type.' created successfully.');

        if (in_array(CreatesMatchingTest::class, class_uses_recursive($this))) {
            $this->handleTestCreation($path);
        }
    }

}