import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddLibraryToFlow1769702400000 implements MigrationInterface {
    name = 'AddLibraryToFlow1769702400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow"
            ADD "library" boolean NOT NULL DEFAULT false
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow" DROP COLUMN "library"
        `)
    }

}
