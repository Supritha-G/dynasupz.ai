import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RecordsService } from './records.service';

@ApiTags('records')
@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  @ApiOperation({ summary: 'List flight recorder entries' })
  @ApiQuery({ name: 'service', required: false })
  @ApiQuery({ name: 'outcome', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('service') service?: string,
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: number,
  ) {
    return this.recordsService.findAll({ service, outcome, limit: limit ? +limit : 20 });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single flight recorder entry' })
  findOne(@Param('id') id: string) {
    return this.recordsService.findOne(id);
  }

  @Get('service/:service/risk-profile')
  @ApiOperation({ summary: 'Get risk profile for a service' })
  getRiskProfile(@Param('service') service: string) {
    return this.recordsService.getRiskProfile(service);
  }
}
