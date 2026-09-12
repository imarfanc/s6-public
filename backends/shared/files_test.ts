import { assertEquals } from "@std/assert";
import { homeRelativePath } from "./files.ts";

Deno.test("homeRelativePath uses ~ when the path sits under $HOME", () => {
  assertEquals(
    homeRelativePath("/Users/example/developer/gh/st6-public", "/Users/example"),
    "~/developer/gh/st6-public",
  );
  assertEquals(homeRelativePath("/Users/example/", "/Users/example"), "~");
  assertEquals(
    homeRelativePath("/opt/st6-public", "/Users/example"),
    "/opt/st6-public",
  );
  assertEquals(
    homeRelativePath("/Users/example/developer/gh/st6-public", undefined),
    "/Users/example/developer/gh/st6-public",
  );
});
