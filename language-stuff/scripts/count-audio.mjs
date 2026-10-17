/** Counts pre-generated clips in Supabase Storage. Used to watch generation progress. */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: folders } = await supabase.storage.from("topic-audio").list("", { limit: 200 });

let clips = 0;
for (const folder of folders ?? []) {
  const { data: inner } = await supabase.storage
    .from("topic-audio")
    .list(folder.name, { limit: 200 });
  clips += (inner ?? []).length;
}

console.log(clips);
