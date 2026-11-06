import { afterEach, expect, test } from "bun:test";
import { TestDatabase } from "../../tests/crud-fixture";
import type { Database } from "./database";
import { createBoardRepository } from "./tauri-board";
import { resolveStage } from "./board-rules";

const databases: TestDatabase[] = [];
function setup() {
  const db = new TestDatabase();
  databases.push(db);
  return { db, board: createBoardRepository(db) };
}
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close(); });

test("board columns validate, retain identity and enforce a complete order", async () => {
  const { board } = setup();
  const input = { name: "  Review  ", color: "#A1B2C3", wipLimit: 3 };
  const created = await board.createBoardColumn(input);
  const column = created.find((item) => item.name === "Review")!;
  expect(column.color).toBe("#a1b2c3");
  expect(column.orderIndex).toBe(3);
  expect((await board.updateBoardColumn(column.id, { ...input, name: "QA" }))
    .find((item) => item.id === column.id)?.name).toBe("QA");
  const ids = [column.id, "doing", "blocked", "todo", "done"];
  expect((await board.reorderBoardColumns(ids)).map((item) => item.id)).toEqual(ids);
  await expect(board.reorderBoardColumns(["todo", "done"])).rejects.toThrow("Order must include");
  await expect(board.reorderBoardColumns(["todo", "doing", "blocked", "done", "done"]))
    .rejects.toThrow("Order must include");
  await expect(board.createBoardColumn({ ...input, name: "  " })).rejects.toThrow("Column name");
  await expect(board.createBoardColumn({ ...input, name: "🙂".repeat(61) })).rejects.toThrow("Column name");
  await expect(board.createBoardColumn({ ...input, color: "red" })).rejects.toThrow("color");
  await expect(board.createBoardColumn({ ...input, wipLimit: 1.5 })).rejects.toThrow("WIP");
  await expect(board.updateBoardColumn("done", input)).rejects.toThrow("Done has no WIP");
  await expect(board.deleteBoardColumn("todo", "doing")).rejects.toThrow("cannot be deleted");
});

test("deleting a column moves active and completed tasks, including replacement chains", async () => {
  const { db, board } = setup();
  db.sqlite.exec(`INSERT INTO board_columns (id,name,color,order_index,updated_at,deleted_at,replacement_id)
    VALUES ('old','Old','#112233',8,'seed','deleted','blocked');
    INSERT INTO tasks (id,title,status,stage,order_index,board_index,created_at,updated_at) VALUES
    ('destination','Destination','active','doing',100,10,'now','now'),
    ('later','Later','done','old',200,4,'now','now'),
    ('earlier','Earlier','active','blocked',300,2,'now','now');`);
  const columns = await board.deleteBoardColumn("blocked", "doing");
  expect(resolveStage("old", columns)).toBe("doing");
  expect(db.sqlite.query("SELECT id, stage, board_index AS boardIndex, order_index AS orderIndex FROM tasks ORDER BY id").all())
    .toEqual([
      { id: "destination", stage: "doing", boardIndex: 10, orderIndex: 100 },
      { id: "earlier", stage: "doing", boardIndex: 11, orderIndex: 300 },
      { id: "later", stage: "doing", boardIndex: 12, orderIndex: 200 },
    ]);
  await expect(board.deleteBoardColumn("doing", "done")).rejects.toThrow("destination");
});

test("column deletion retries if another window adds a task before the transaction", async () => {
  const { db } = setup();
  let injected = false;
  const concurrent: Database = { async run(operations) {
    const rows = await db.run(operations);
    if (!injected && operations.length === 2 && operations[0].statement === "board.columns" &&
        operations[1].statement === "board.tasks") {
      injected = true;
      db.sqlite.exec("INSERT INTO tasks(id,title,stage,board_index,created_at,updated_at) VALUES ('new','New','blocked',5,'now','now')");
    }
    return rows;
  } };
  await createBoardRepository(concurrent).deleteBoardColumn("blocked", "doing");
  expect(injected).toBe(true);
  expect(db.sqlite.query("SELECT stage FROM tasks WHERE id='new'").get()).toEqual({ stage: "doing" });
});
