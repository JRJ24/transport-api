import { Module } from '@nestjs/common';
import { CatalogsController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';
import { TerritoryMatchService } from './territory-match.service';

@Module({
  controllers: [CatalogsController],
  providers: [CatalogsService, TerritoryMatchService],
  exports: [TerritoryMatchService],
})
export class CatalogsModule {}
