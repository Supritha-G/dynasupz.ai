import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeploymentActionDto {
  @ApiProperty({ enum: ['approve', 'force_rollback', 'notify_oncall'] })
  @IsEnum(['approve', 'force_rollback', 'notify_oncall'])
  action: 'approve' | 'force_rollback' | 'notify_oncall';

  @ApiProperty({ example: 'supritha@company.com' })
  @IsString()
  actor: string;
}
