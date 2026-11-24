UPDATE `themes` SET `position` = CASE `name`
  WHEN 'Tech' THEN 0
  WHEN 'Blogs' THEN 1
  WHEN 'News' THEN 2
  WHEN 'Arts' THEN 3
  WHEN 'Music' THEN 4
  WHEN 'Laundry List' THEN 5
  ELSE `position` + 10
END;
