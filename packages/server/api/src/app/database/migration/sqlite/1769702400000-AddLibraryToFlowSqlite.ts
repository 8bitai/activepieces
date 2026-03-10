import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddLibraryToFlowSqlite1769702400000 implements MigrationInterface {
    name = 'AddLibraryToFlowSqlite1769702400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow"
            ADD COLUMN "library" boolean NOT NULL DEFAULT 0
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow" DROP COLUMN "library"
        `)
    }

}
