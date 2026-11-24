ALTER TABLE articles ADD COLUMN word_count integer;
--> statement-breakpoint
UPDATE articles SET word_count = case when body is null then 0 else max(0, 1 + (length(replace(replace(replace(replace(replace(body, char(13), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) - length(replace(replace(replace(replace(replace(replace(replace(replace(body, char(13), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), ' ', ''), char(10), ''), char(9), ''))) - 4 * ((length(body) - length(replace(body, '<a ', ''))) / 3)) end;
