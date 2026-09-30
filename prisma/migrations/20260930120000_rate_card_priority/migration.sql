-- Rate cards: explicit priority between active cards, one rule per category.

ALTER TABLE "PRICES"."rate_cards" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;

-- One rule per vehicle category inside a card. Existing duplicates must be
-- merged by hand first; until then the index is skipped with a notice.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PRICES"."rate_rule"
    GROUP BY "rate_card_id", "vehicule_category_id"
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "rate_rule_card_category_key"
      ON "PRICES"."rate_rule"("rate_card_id", "vehicule_category_id");
  ELSE
    RAISE NOTICE 'rate_rule has duplicate (card, category) rules; unique index NOT created';
  END IF;
END $$;
