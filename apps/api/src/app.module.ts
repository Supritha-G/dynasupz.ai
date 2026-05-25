import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { AgentModule } from './agent/agent.module';
import { SkillsModule } from './skills/skills.module';
import { DynatraceModule } from './dynatrace/dynatrace.module';
import { RecordsModule } from './records/records.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    DynatraceModule,
    SkillsModule,
    AgentModule,
    DeploymentsModule,
    RecordsModule,
  ],
})
export class AppModule {}
