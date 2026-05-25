import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { DeploymentsService } from './deployments.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { DeploymentActionDto } from './dto/deployment-action.dto';

@ApiTags('deployments')
@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Receive deployment webhook from GitHub Actions' })
  create(@Body() dto: CreateDeploymentDto) {
    return this.deploymentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active deployment sessions' })
  findActive() {
    return this.deploymentsService.findActive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deployment session by ID' })
  findOne(@Param('id') id: string) {
    return this.deploymentsService.findOne(id);
  }

  @Post(':id/actions')
  @ApiOperation({ summary: 'Trigger a manual action on a deployment' })
  action(@Param('id') id: string, @Body() dto: DeploymentActionDto) {
    return this.deploymentsService.handleAction(id, dto);
  }

  @Sse(':id/stream')
  @ApiOperation({ summary: 'SSE stream for live deployment updates' })
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return this.deploymentsService.getStream(id);
  }
}
