import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPushToEmbedToFlow1769802400000 implements MigrationInterface {
    name = 'AddPushToEmbedToFlow1769802400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow"
            ADD "pushToEmbed" boolean NOT NULL DEFAULT false
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "flow" DROP COLUMN "pushToEmbed"
        `)
    }

}
