## [0.3.0](https://github.com/asdfprah/vifrost/compare/vifrost-codegen-v0.2.2...vifrost-codegen-v0.3.0) (2026-10-27)

### Features

* **codegen:** generate composite primary keys ([26e7896](https://github.com/asdfprah/vifrost/commit/26e789687d9fa3f4e310b075425648e6aaf0cc69)), closes [#26](https://github.com/asdfprah/vifrost/issues/26)

## [0.2.2](https://github.com/asdfprah/vifrost/compare/vifrost-codegen-v0.2.1...vifrost-codegen-v0.2.2) (2026-10-27)

### Features

* **client:** added methods to obtain items total count ([1b1df95](https://github.com/asdfprah/vifrost/commit/1b1df95e09b2b87bb97f2896594388505b5e0382))
* **client:** support composite primary keys ([5eb6083](https://github.com/asdfprah/vifrost/commit/5eb60838e12d3ba0b661ae7c4dc2c8c467eb3661)), closes [#26](https://github.com/asdfprah/vifrost/issues/26)
* **laravel:** added ulid uuid compatibility ([8df9159](https://github.com/asdfprah/vifrost/commit/8df91597dd1091ca7255e042a55bdadfe610457f))
* **laravel:** exclude models and pivots from discovery ([987f959](https://github.com/asdfprah/vifrost/commit/987f9597877b8c68926476dc627aa531153fa1b4)), closes [#24](https://github.com/asdfprah/vifrost/issues/24) [#27](https://github.com/asdfprah/vifrost/issues/27)
* **laravel:** implemented models cache ([fb8e738](https://github.com/asdfprah/vifrost/commit/fb8e73889aef296c01f02e31f462e0e099f5e5c9))
* **laravel:** improved controller test ([8fedf12](https://github.com/asdfprah/vifrost/commit/8fedf12346b0d9e4807b1532c4c1443e5ddfcbec))
* **laravel:** make api command ask for confirmation before overwrite ([e9ebfaa](https://github.com/asdfprah/vifrost/commit/e9ebfaa0a235fa49f439695facf549c86cbacca2))
* **laravel:** moved pagination to controller, added count header ([d105ce0](https://github.com/asdfprah/vifrost/commit/d105ce0a6a92617e3ba6ecac0e91ab86a5c02e76))
* **laravel:** support composite primary keys ([4c46b0a](https://github.com/asdfprah/vifrost/commit/4c46b0ac9b5d4c5d13b29e13218708f91cecc848)), closes [#26](https://github.com/asdfprah/vifrost/issues/26)
* **vue:** support composite primary keys in useQuery and useModel ([98778fe](https://github.com/asdfprah/vifrost/commit/98778fedd83386e4aafc200239fdf9dd758d4f83)), closes [#26](https://github.com/asdfprah/vifrost/issues/26)
* **vue:** updated useQuery to expose total count ([7ac8c89](https://github.com/asdfprah/vifrost/commit/7ac8c8988012954dc829cce13466f6360537dd4c))

### Bug Fixes

* **codegen:** map Postgres bpchar, timestamptz, timetz, inet and macaddr ([526162b](https://github.com/asdfprah/vifrost/commit/526162b3fcb4808c062aa86f971743b829a4e636)), closes [#25](https://github.com/asdfprah/vifrost/issues/25)
* **laravel:** generate nullable, ISO date, array and bpchar rules ([52d2813](https://github.com/asdfprah/vifrost/commit/52d2813faa8824d19dae915a09b773fc974db8b7)), closes [#15](https://github.com/asdfprah/vifrost/issues/15) [#16](https://github.com/asdfprah/vifrost/issues/16) [#19](https://github.com/asdfprah/vifrost/issues/19) [#20](https://github.com/asdfprah/vifrost/issues/20)
* **laravel:** generate routes with LF and only for routable relations ([9609c65](https://github.com/asdfprah/vifrost/commit/9609c65f8c16577ddec4b49e4741e3b21c432c81)), closes [#18](https://github.com/asdfprah/vifrost/issues/18) [#21](https://github.com/asdfprah/vifrost/issues/21) [#22](https://github.com/asdfprah/vifrost/issues/22)
* **laravel:** resolve composite foreign keys to the right column ([5451fbc](https://github.com/asdfprah/vifrost/commit/5451fbce33bf939dcc2e33efea9c9cd1866d5c91)), closes [#17](https://github.com/asdfprah/vifrost/issues/17)
* **laravel:** respond 404 from show() for missing records ([cf8b1eb](https://github.com/asdfprah/vifrost/commit/cf8b1eb5014763fdf1c6a4a1f85dc57ad6f5cc25)), closes [#23](https://github.com/asdfprah/vifrost/issues/23)
* **vue:** accept any published 0.x @vifrost/client ([9f28dee](https://github.com/asdfprah/vifrost/commit/9f28deef818d51889065f560170c5befca293707)), closes [#14](https://github.com/asdfprah/vifrost/issues/14)
* **vue:** resolve @vifrost/client locally without breaking npm ci ([6dea7f7](https://github.com/asdfprah/vifrost/commit/6dea7f78185cbad5d6ee4a948efc1b1b683384b6))

## [0.2.1](https://github.com/asdfprah/vifrost/compare/vifrost-codegen-v0.2.0...vifrost-codegen-v0.2.1) (2026-09-11)

### Bug Fixes

* **codegen:** add repository field to package.json for npm provenance ([cefe94f](https://github.com/asdfprah/vifrost/commit/cefe94f2e44b0818ed5d10b126a53f5d34d82275))

## [0.2.0](https://github.com/asdfprah/vifrost/compare/vifrost-codegen-v0.1.0...vifrost-codegen-v0.2.0) (2026-09-11)

### Features

* **client:** added relation guard and lazy load method ([aa3f372](https://github.com/asdfprah/vifrost/commit/aa3f3726db522a3fcd140009f91c9f3bba8c56c7))
* **codegen:** model list of relations ([df371b4](https://github.com/asdfprah/vifrost/commit/df371b4929dd11609862dcb1e91b9d3981b00cd0))
