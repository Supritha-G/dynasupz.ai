import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDeploymentDto {
  @ApiProperty({ enum: ['pre_deploy', 'deploy_complete', 'rollback_complete'] })
  @IsEnum(['pre_deploy', 'deploy_complete', 'rollback_complete'])
  event: 'pre_deploy' | 'deploy_complete' | 'rollback_complete';

  @ApiProperty({ example: 'org/payment-service' })
  @IsString()
  repo: string;

  @ApiProperty({ example: 'payment-service' })
  @IsString()
  service: string;

  @ApiProperty({ example: 'abc123def456' })
  @IsString()
  commit_sha: string;

  @ApiProperty({ example: '789ghi012jkl' })
  @IsString()
  base_sha: string;

  @ApiProperty({ example: 'deploy-789' })
  @IsString()
  deployment_id: string;

  @IsString()
  @IsOptional()
  commit_message?: string;

  @IsString()
  @IsOptional()
  triggered_by?: string;
}
