import { Product, ProductVariant, SelectedModifier } from '@/types/Product';

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getProductVariants = (product: Partial<Product> | null | undefined): ProductVariant[] => {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants.map((variant, index) => ({
      id: String(variant?.id || `variant-${index + 1}`),
      name: String(variant?.name || `Variant ${index + 1}`),
      description: String(variant?.description || ''),
      price: toNumber(variant?.appPrice ?? variant?.price, 0),
      appPrice: variant?.appPrice == null ? null : toNumber(variant.appPrice, 0),
    }));
  }

  const derived: ProductVariant[] = [];
  if (product?.price != null) {
    derived.push({
      id: 'variant-1',
      name: 'Regular',
      description: '',
      price: toNumber(product.price, 0),
      appPrice: null,
    });
  }

  if (product?.halfPrice != null) {
    derived.push({
      id: `variant-${derived.length + 1}`,
      name: 'Half',
      description: '',
      price: toNumber(product.halfPrice, 0),
      appPrice: null,
    });
  }

  return derived;
};

export const getSelectedProductVariant = (
  product: Partial<Product> | null | undefined,
  variantId?: string | null
): ProductVariant | null => {
  const variants = getProductVariants(product);
  if (variants.length === 0) return null;
  if (!variantId) return variants[0];
  return variants.find((variant) => String(variant.id) === String(variantId)) || variants[0];
};

/** Stable, order-independent serialization of a customer's modifier picks — used only to
 *  tell cart lines apart (two different sets of picks must never merge into one line),
 *  never sent anywhere itself. */
const serializeSelectedModifiers = (selections?: SelectedModifier[] | null): string => {
  if (!selections || selections.length === 0) return '';
  return selections
    .map((s) => `${s.modifierId}:${[...s.optionNames].sort().join(',')}`)
    .sort()
    .join('|');
};

export const buildProductCartKey = (item: Partial<Product> | null | undefined) => {
  const baseId = String(item?.firebaseId || item?.baseProductId || item?.id || '');
  const variantId = String(item?.selectedVariantId || 'default');
  const dealId = String(item?.isDeal ? (item?.dealId || '') : '').trim();
  const dealSuffix = dealId ? `::deal:${dealId}` : '';
  const modifiersKey = serializeSelectedModifiers(item?.selectedModifiers);
  const modifiersSuffix = modifiersKey ? `::mods:${modifiersKey}` : '';
  const addonIds = [...(item?.selectedAddonIds || [])].sort();
  const addonsSuffix = addonIds.length > 0 ? `::addons:${addonIds.join(',')}` : '';
  return `${baseId}::${variantId}${dealSuffix}${modifiersSuffix}${addonsSuffix}`;
};

export const buildCartItemFromProduct = (
  product: Product,
  variantId?: string | null,
  selections?: { modifiers?: SelectedModifier[]; addonIds?: string[]; modifierPriceDelta?: number; addonPriceDelta?: number }
) => {
  const selectedVariant = getSelectedProductVariant(product, variantId);
  const basePrice = toNumber(selectedVariant?.price ?? product.price, 0);
  const extraPrice = toNumber(selections?.modifierPriceDelta, 0) + toNumber(selections?.addonPriceDelta, 0);
  return {
    ...product,
    baseProductId: String(product.firebaseId || product.id || ''),
    price: basePrice + extraPrice,
    selectedVariantId: selectedVariant?.id || null,
    selectedVariantName: selectedVariant?.name || null,
    selectedVariantDescription: selectedVariant?.description || null,
    selectedModifiers: selections?.modifiers && selections.modifiers.length > 0 ? selections.modifiers : undefined,
    selectedAddonIds: selections?.addonIds && selections.addonIds.length > 0 ? selections.addonIds : undefined,
    createdAt:
      product.createdAt && typeof product.createdAt?.toMillis === 'function'
        ? product.createdAt.toMillis()
        : product.createdAt,
    quantity: 1,
  };
};