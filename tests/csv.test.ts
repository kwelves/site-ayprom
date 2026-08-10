import { describe, expect, it } from "vitest";
import { parseCsv, csvToRecords } from "@/lib/admin/csv";

describe("parseCsv", () => {
  it("разбирает простые строки без кавычек", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("сохраняет запятую внутри кавычек", () => {
    expect(parseCsv('name,note\n"Насос, гидравлический",ок')).toEqual([
      ["name", "note"],
      ["Насос, гидравлический", "ок"],
    ]);
  });

  it("разэкранирует двойную кавычку внутри поля", () => {
    expect(parseCsv('a\n"он сказал ""привет"""')).toEqual([["a"], ['он сказал "привет"']]);
  });

  it("сохраняет перевод строки внутри кавычек как часть поля", () => {
    expect(parseCsv('a,b\n"строка1\nстрока2",x')).toEqual([
      ["a", "b"],
      ["строка1\nстрока2", "x"],
    ]);
  });

  it("понимает и \\n, и \\r\\n как разделители строк", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("не падает на файле без завершающего перевода строки", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("отбрасывает BOM в начале файла", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("игнорирует полностью пустые строки", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});

describe("csvToRecords", () => {
  it("приводит заголовок к нижнему регистру и строит объекты по нему", () => {
    const { header, rows } = csvToRecords("Name,Article\nНасос,AY-1");
    expect(header).toEqual(["name", "article"]);
    expect(rows).toEqual([{ name: "Насос", article: "AY-1" }]);
  });

  it("обрезает пробелы в заголовке и значениях", () => {
    const { header, rows } = csvToRecords(" name , article \n Насос , AY-1 ");
    expect(header).toEqual(["name", "article"]);
    expect(rows).toEqual([{ name: "Насос", article: "AY-1" }]);
  });

  it("недостающие колонки в строке дают пустую строку, а не undefined", () => {
    const { rows } = csvToRecords("name,article\nНасос");
    expect(rows).toEqual([{ name: "Насос", article: "" }]);
  });
});
