import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Catalog } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { CatalogsService } from './catalogs.service';
import { CreateCatalogDto } from './dto/create-catalog.dto';
import { UpdateCatalogDto } from './dto/update-catalog.dto';

@ApiTags('catalogs')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly service: CatalogsService) {}

  @ApiOperation({ summary: 'List catalogs' })
  @Get()
  list(@Query() query: CatalogQueryDto): Promise<Catalog[]> {
    return this.service.list(query);
  }

  @ApiOperation({ summary: 'Create catalog item' })
  @Post()
  create(@Body() dto: CreateCatalogDto): Promise<Catalog> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Update catalog item' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogDto,
  ): Promise<Catalog> {
    return this.service.update(id, dto);
  }
}
