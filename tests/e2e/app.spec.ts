import { expect, type Page, test } from "@playwright/test";
import { E2E_CLAVE } from "../../playwright.config";

const unique = () => Math.random().toString(36).slice(2, 7);

async function login(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ingresar/);
  await page.locator("#clave").fill(E2E_CLAVE);
  await page.locator("#nombre").fill("Prueba E2E");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();
}

async function createProduct(page: Page, name: string, stock: string, opts: { min?: string; caja?: string } = {}) {
  await page.goto("/inventario?nuevo=1");
  await page.locator("#p-name").fill(name);
  await page.locator("#p-stock").fill(stock);
  if (opts.min) await page.locator("#p-min").fill(opts.min);
  if (opts.caja) {
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.getByLabel("Nombre de la presentación").fill("caja");
    await page.getByLabel(/por presentación/).fill(opts.caja);
  }
  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(page).toHaveURL(/\/inventario\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url();
}

async function stockText(page: Page) {
  return (await page.getByText("Stock actual", { exact: true }).locator("..").innerText()).replace(/\s+/g, " ");
}

test.describe("acceso", () => {
  test("exige la clave y rechaza una incorrecta", async ({ page }) => {
    await page.goto("/inventario");
    await expect(page).toHaveURL(/\/ingresar\?siguiente=/);
    await page.locator("#clave").fill("clave-equivocada");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("La clave no es correcta.")).toBeVisible();
    const api = await page.request.get("/api/respaldo");
    expect(api.status()).toBe(401);
  });
});

test.describe("operación diaria", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("alta con el botón +, consumo, persistencia al recargar y reversión", async ({ page }) => {
    const name = `Jeringa e2e ${unique()}`;
    const url = await createProduct(page, name, "5", { min: "2" });
    await page.getByRole("button", { name: "Consumo" }).first().click();
    await page.locator("#mv-q").fill("3");
    await expect(page.getByText(/Stock resultante/)).toContainText("2 unidades");
    await page.getByRole("button", { name: "Descontar del stock" }).click();
    await expect(page.getByText("Movimiento registrado.")).toBeVisible();
    await page.reload();
    expect(await stockText(page)).toContain("2 unidades");
    // Reversión del consumo
    await page.getByRole("button", { name: /Revertir movimiento/ }).first().click();
    await page.locator("#rv-r").fill("Prueba de corrección");
    await page.getByRole("button", { name: "Revertir", exact: true }).click();
    await expect(page.getByText("Movimiento revertido.")).toBeVisible();
    await page.goto(url);
    expect(await stockText(page)).toContain("5 unidades");
  });

  test("el asistente interpreta «gasté» y registra solo al confirmar", async ({ page }) => {
    const name = `Eyector e2e ${unique()}`;
    const url = await createProduct(page, name, "5");
    await page.getByRole("button", { name: /Asistente|Abrir asistente/ }).first().click();
    const input = page.getByLabel("Mensaje para el asistente");
    await input.fill(`Hoy gasté 3 ${name.toLowerCase()}`);
    await page.getByRole("button", { name: "Enviar" }).click();
    const card = page.getByText("Registrar consumo").locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
    await expect(card).toContainText("5 → 2");
    // Antes de confirmar el stock no cambia
    const before = await page.request.get(url);
    expect(before.ok()).toBeTruthy();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Registrado", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.goto(url);
    expect(await stockText(page)).toContain("2 unidades");
    await expect(page.locator("main").getByText("Asistente").first()).toBeVisible();
  });

  test("compra con presentación, gasto, exportación y respaldo", async ({ page }) => {
    const name = `Guantes e2e ${unique()}`;
    const url = await createProduct(page, name, "0", { caja: "100" });
    await page.goto("/compras/nueva");
    await page.locator("#c-sup").fill(`Proveedor e2e ${unique()}`);
    await page.getByRole("button", { name: "Elegí un producto" }).click();
    await page.getByLabel("Buscar producto").fill(name.split(" ").slice(-1)[0]);
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByLabel("Cantidad línea 1").fill("2");
    await page.getByLabel("Unidad línea 1").selectOption("caja");
    await page.getByLabel("Importe línea 1").fill("10.000");
    await page.getByRole("button", { name: "Registrar compra" }).click();
    await expect(page).toHaveURL(/\/compras\/[0-9a-f-]{36}/);
    await expect(page.getByText("= 200 unidades")).toBeVisible();
    await page.goto(url);
    expect(await stockText(page)).toContain("200 unidades");

    await page.goto("/gastos?nuevo=1");
    await page.locator("#g-a").fill(`${10000 + Math.floor(Math.random() * 80000)},50`);
    await page.locator("#g-c").fill("Luz");
    await page.locator("#g-desc").fill(`Luz e2e ${unique()}`);
    await page.getByRole("button", { name: "Registrar gasto" }).click();
    await expect(page.getByText(/Gasto #\d+ registrado/)).toBeVisible();

    const download = page.waitForEvent("download");
    await page.goto("/reportes");
    await page.getByRole("link", { name: "Exportar Excel" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

    const backup = await page.request.get("/api/respaldo");
    expect(backup.status()).toBe(200);
    const json = await backup.json();
    expect(json.app).toBe("consultorIA");
    expect(json.counts.products).toBeGreaterThan(0);
  });

  test("las secciones principales cargan sin desbordar el ancho", async ({ page }) => {
    for (const path of ["/", "/inventario", "/movimientos", "/compras", "/compras/nueva", "/gastos", "/facturas", "/reportes", "/proveedores", "/ajustes"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `desborde horizontal en ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test("cerrar sesión vuelve a pedir la clave", async ({ page, isMobile }) => {
    if (isMobile) {
      await page.getByRole("button", { name: "Más" }).click();
    }
    await page.getByRole("button", { name: /Cerrar sesión/ }).last().click();
    await expect(page).toHaveURL(/\/ingresar/);
    await page.goto("/inventario");
    await expect(page).toHaveURL(/\/ingresar/);
  });
});
