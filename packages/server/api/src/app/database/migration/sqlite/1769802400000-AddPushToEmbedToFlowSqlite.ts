import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPushToEmbedToFlowSqlite1769802400000 implements MigrationInterface {
    name = 'AddPushToEmbedToFlowSqlite1769802400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow"
            ADD COLUMN "pushToEmbed" boolean NOT NULL DEFAULT 0
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow" DROP COLUMN "pushToEmbed"
        `)
    }

}
