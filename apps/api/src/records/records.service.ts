import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filters: { service?: string; outcome?: string; limit: number }) {
    return this.prisma.deploymentRecord.findMany({
      where: {
        ...(filters.service && { service: filters.service }),
        ...(filters.outcome && { outcome: filters.outcome as never }),
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
      select: {
        id: true,
        createdAt: true,
        repo: true,
        service: true,
        commitSha: true,
        commitMessage: true,
        triggeredBy: true,
        outcome: true,
        riskScore: true,
        anomalyDetected: true,
        rollbackExecuted: true,
        deployStartedAt: true,
        deployCompletedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.deploymentRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Record ${id} not found`);
    return record;
  }

  getRiskProfile(service: string) {
    return this.prisma.serviceRiskProfile.findMany({
      where: { service },
      orderBy: { incidentRate: 'desc' },
    });
  }
}
