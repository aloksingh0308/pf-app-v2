import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import AppImage from '@/components/AppImage';
import FloatingCartButton from '@/components/FloatingCartButton';
import FoodTypeMark, { FOOD_TYPE_LABELS } from '@/components/common/FoodTypeMark';
import { decrementQuantity, incrementQuantity } from '@/store/slices/cartSlice';
import { AddonOption, ModifierGroup, Product, SelectedModifier } from '@/types/Product';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { buildCartItemFromProduct, buildProductCartKey, getProductVariants, getSelectedProductVariant } from '@/utils/productVariants';
import { showAlert } from '@/services/alertService';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { getAddons, getModifiers } from '@/services/menuService';

const ProductDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const { addItem } = useAddToCartWithRestaurantGuard();
  const { product } = useLocalSearchParams();
  const parsedProduct: Product = JSON.parse(
    Array.isArray(product) ? product[0] : product!
  );
  const variants = useMemo(() => getProductVariants(parsedProduct), [parsedProduct]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(variants[0]?.id || null);
  const selectedVariant = getSelectedProductVariant(parsedProduct, selectedVariantId);

  // Modifier groups / addons this item can be customized with — fetched once and filtered
  // down to whatever this specific item references (menuService.getModifiers/getAddons
  // return the whole branch catalog, same pattern as variants already used above).
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [addonOptions, setAddonOptions] = useState<AddonOption[]>([]);
  const [selectedModifierOptions, setSelectedModifierOptions] = useState<Record<string, string[]>>({});
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const modifierGroupIds = new Set((parsedProduct.modifierGroupIds || []).map(String));
    const addonIds = new Set((parsedProduct.addonIds || []).map(String));
    if (modifierGroupIds.size === 0 && addonIds.size === 0) return;

    (async () => {
      try {
        const [allModifiers, allAddons] = await Promise.all([getModifiers(), getAddons()]);
        if (!active) return;
        const groups = allModifiers.filter((m) => modifierGroupIds.has(m.id));
        setModifierGroups(groups);
        setAddonOptions(allAddons.filter((a) => addonIds.has(a.id)));
        // Pre-select every required group's first option(s) up to minSelect, so a
        // required single-select group already has a valid default rather than forcing
        // an extra tap before Add to Cart is even enabled.
        const defaults: Record<string, string[]> = {};
        groups.forEach((group) => {
          if (group.required && group.minSelect > 0) {
            defaults[group.id] = group.options.slice(0, group.minSelect).map((o) => o.name);
          }
        });
        setSelectedModifierOptions(defaults);
      } catch (error) {
        console.warn('Failed to load modifiers/addons.', error);
      }
    })();

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedProduct.firebaseId]);

  const toggleModifierOption = (group: ModifierGroup, optionName: string) => {
    setSelectedModifierOptions((current) => {
      const chosen = current[group.id] || [];
      if (!group.multiSelect) {
        return { ...current, [group.id]: chosen.includes(optionName) && !group.required ? [] : [optionName] };
      }
      if (chosen.includes(optionName)) {
        return { ...current, [group.id]: chosen.filter((name) => name !== optionName) };
      }
      if (chosen.length >= group.maxSelect) {
        showAlert('Selection Limit', `You can select up to ${group.maxSelect} option${group.maxSelect === 1 ? '' : 's'} for ${group.name}.`);
        return current;
      }
      return { ...current, [group.id]: [...chosen, optionName] };
    });
  };

  const toggleAddon = (addonId: string) => {
    setSelectedAddonIds((current) => (current.includes(addonId) ? current.filter((id) => id !== addonId) : [...current, addonId]));
  };

  const selectedModifiers: SelectedModifier[] = useMemo(
    () =>
      modifierGroups
        .map((group) => ({ modifierId: group.id, optionNames: selectedModifierOptions[group.id] || [] }))
        .filter((s) => s.optionNames.length > 0),
    [modifierGroups, selectedModifierOptions]
  );

  const modifierPriceDelta = useMemo(() => {
    return modifierGroups.reduce((sum, group) => {
      const chosen = new Set(selectedModifierOptions[group.id] || []);
      return sum + group.options.filter((o) => chosen.has(o.name)).reduce((s, o) => s + o.priceDelta, 0);
    }, 0);
  }, [modifierGroups, selectedModifierOptions]);

  const addonPriceDelta = useMemo(
    () => addonOptions.filter((a) => selectedAddonIds.includes(a.id)).reduce((sum, a) => sum + a.price, 0),
    [addonOptions, selectedAddonIds]
  );

  const missingRequiredGroup = useMemo(
    () => modifierGroups.find((group) => group.required && (selectedModifierOptions[group.id] || []).length < Math.max(1, group.minSelect)),
    [modifierGroups, selectedModifierOptions]
  );

  const cartKey = buildProductCartKey({
    ...parsedProduct,
    selectedVariantId: selectedVariant?.id || null,
    selectedModifiers,
    selectedAddonIds,
  });

  const cartItems = useSelector((state: any) => state.cart.items);
  const cartEntry = cartItems.find((item: Product & { quantity: number }) => buildProductCartKey(item) === cartKey);
  const isAdded = Boolean(cartEntry);
  const currentQty = Number(cartEntry?.quantity || 1);
  const outOfStock = parsedProduct.inStock === false;

  const handleAddToCart = () => {
    if (outOfStock) {
      showAlert('Out of Stock', 'This item is currently out of stock.');
      return;
    }
    if (missingRequiredGroup) {
      showAlert('Selection Required', `Please select an option for ${missingRequiredGroup.name}.`);
      return;
    }
    addItem(
      buildCartItemFromProduct(parsedProduct, selectedVariant?.id || null, {
        modifiers: selectedModifiers,
        addonIds: selectedAddonIds,
        modifierPriceDelta,
        addonPriceDelta,
      })
    );
  };

  const handleIncrement = () => {
    if (outOfStock) {
      showAlert('Out of Stock', 'This item is currently out of stock.');
      return;
    }
    dispatch(incrementQuantity(cartKey));
  };

  const handleDecrement = () => {
    dispatch(decrementQuantity(cartKey));
  };

  const fixFirebaseUrl = (url: string) => {
    if (!url) return url;

    return url.replace(
      /(menu-items)\//g,
      "$1%2F"
    );
  };

  const imageUri = parsedProduct.images && parsedProduct.images.length > 0 ? fixFirebaseUrl(parsedProduct.images?.[0]) : 'https://via.placeholder.com/300';
  const qtyAndServes = [parsedProduct.qty, parsedProduct.serves]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' • ');
  const variantPrice = Number(selectedVariant?.price ?? parsedProduct.price ?? 0);
  const unitPrice = variantPrice + modifierPriceDelta + addonPriceDelta;
  const actionQty = isAdded ? currentQty : 1;
  const actionTotal = unitPrice * actionQty;
  const actionLabel = `${actionQty} ${actionQty === 1 ? 'item' : 'items'} • ₹${actionTotal.toFixed(2)}`;
  console.log('Image URI:', imageUri);
  return (
    <Screen>
      <PageHeader title="Product Details" />
      <Container contentContainerStyle={{ paddingBottom: Math.max(140, insets.bottom + 110) }}>


        <ProductImage uri={imageUri} contentFit="cover" />
        <DetailsCard>
          {parsedProduct.foodType ? (
            <FoodTypeRow>
              <FoodTypeMark foodType={parsedProduct.foodType} size={16} />
              <FoodTypeLabel>{FOOD_TYPE_LABELS[parsedProduct.foodType]}</FoodTypeLabel>
            </FoodTypeRow>
          ) : null}
          <Title>{parsedProduct.name}</Title>
          {qtyAndServes ? <MetaText>{qtyAndServes}</MetaText> : null}
          {outOfStock ? <StockStatusText>Currently out of stock</StockStatusText> : null}

          {variants.length > 0 ? (
            <VariantSection>
              <VariantSectionTitle>Select Variant</VariantSectionTitle>
              <VariantList>
                {variants.map((variant) => {
                  const active = String(variant.id) === String(selectedVariant?.id || '');
                  return (
                    <VariantButton
                      key={variant.id || variant.name}
                      onPress={() => setSelectedVariantId(variant.id || null)}
                      $active={active}
                    >
                      <VariantName $active={active}>{variant.name}</VariantName>
                      {variant.description ? <VariantMeta $active={active}>{variant.description}</VariantMeta> : null}
                      <VariantPrice $active={active}>₹{Number(variant.price || 0).toFixed(2)}</VariantPrice>
                    </VariantButton>
                  );
                })}
              </VariantList>
            </VariantSection>
          ) : null}

          <PriceRow>
            <Price>₹{unitPrice.toFixed(2)}</Price>
          </PriceRow>

          <Description>{parsedProduct.description}</Description>

          {modifierGroups.map((group) => (
            <VariantSection key={group.id}>
              <VariantSectionTitle>
                {group.name}{group.required ? ' (Required)' : ' (Optional)'}
                {group.multiSelect ? ` · Choose up to ${group.maxSelect}` : ''}
              </VariantSectionTitle>
              <VariantList>
                {group.options.map((option) => {
                  const active = (selectedModifierOptions[group.id] || []).includes(option.name);
                  return (
                    <VariantButton key={option.name} onPress={() => toggleModifierOption(group, option.name)} $active={active}>
                      <ModifierOptionRow>
                        <VariantName $active={active}>{option.name}</VariantName>
                        {option.priceDelta > 0 ? <VariantPrice $active={active}>+₹{option.priceDelta.toFixed(2)}</VariantPrice> : null}
                      </ModifierOptionRow>
                    </VariantButton>
                  );
                })}
              </VariantList>
            </VariantSection>
          ))}

          {addonOptions.length > 0 && (
            <VariantSection>
              <VariantSectionTitle>Add-ons (Optional)</VariantSectionTitle>
              <VariantList>
                {addonOptions.map((addon) => {
                  const active = selectedAddonIds.includes(addon.id);
                  return (
                    <VariantButton key={addon.id} onPress={() => toggleAddon(addon.id)} $active={active}>
                      <ModifierOptionRow>
                        <VariantName $active={active}>{addon.name}</VariantName>
                        <VariantPrice $active={active}>+₹{addon.price.toFixed(2)}</VariantPrice>
                      </ModifierOptionRow>
                    </VariantButton>
                  );
                })}
              </VariantList>
            </VariantSection>
          )}
        </DetailsCard>
      </Container>

      <BottomActionBar bottomInset={insets.bottom}>
        <BottomActionRow>
          <BottomSummary>{actionLabel}</BottomSummary>
          {isAdded ? (
            <QuantityRow>
              <QtyBtn onPress={handleDecrement}>
                <QtyText>-</QtyText>
              </QtyBtn>
              <QtyValue>{currentQty}</QtyValue>
              <QtyBtn onPress={handleIncrement}>
                <QtyText>+</QtyText>
              </QtyBtn>
            </QuantityRow>
          ) : (
            <AddButton onPress={handleAddToCart} $disabled={outOfStock}>
              <AddText $disabled={outOfStock}>{outOfStock ? 'Out of Stock' : 'Add to Cart'}</AddText>
            </AddButton>
          )}
        </BottomActionRow>
      </BottomActionBar>

      <FloatingCartButton bottomOffset={Math.max(96, insets.bottom + 84)} />
    </Screen>
  );
};

export default ProductDetailScreen;

const Screen = styled(PageScreen)`
  flex: 1;
  background-color: #fff;
`;

const Container = styled.ScrollView`
  flex: 1;
  padding: 20px;
  background-color: #fff;
`;




const ProductImage = styled(AppImage)`
  width: 100%;
  height: 320px;
  border-radius: 12px;
  background-color: #f5f5f5;
`;

const DetailsCard = styled.View`
  margin-top: 14px;
  background-color: #fff;
  border-width: 1px;
  border-color: #ededed;
  border-radius: 14px;
  padding: 14px;
`;

const Description = styled.Text`
  font-size: 17px;
  color: #555;
  margin-top: 10px;
  line-height: 24px;
`;

const MetaText = styled.Text`
  font-size: 15px;
  color: #1a1a1a;
  margin-top: 8px;
  font-weight: 500;
`;

const StockStatusText = styled.Text`
  font-size: 14px;
  color: #c2410c;
  margin-top: 8px;
  font-weight: 700;
`;

const Title = styled.Text`
  font-size: 24px;
  font-weight: 800;
`;

const PriceRow = styled.View`
  flex-direction: row;
  align-items: baseline;
  column-gap: 10px;
  margin-top: 10px;
`;

const VariantSection = styled.View`
  margin-top: 14px;
`;

const VariantSectionTitle = styled.Text`
  font-size: 15px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 8px;
`;

const VariantList = styled.View`
  row-gap: 8px;
`;

const ModifierOptionRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const VariantButton = styled.TouchableOpacity<{ $active: boolean }>`
  border-width: 1px;
  border-color: ${({ $active }) => ($active ? '#f68712' : '#e5e7eb')};
  background-color: ${({ $active }) => ($active ? '#fff7ef' : '#fff')};
  border-radius: 12px;
  padding: 12px;
`;

const VariantName = styled.Text<{ $active: boolean }>`
  font-size: 15px;
  font-weight: 700;
  color: ${({ $active }) => ($active ? '#c96a0a' : '#1f2937')};
`;

const VariantMeta = styled.Text<{ $active: boolean }>`
  font-size: 13px;
  color: ${({ $active }) => ($active ? '#9a6708' : '#6b7280')};
  margin-top: 4px;
`;

const VariantPrice = styled.Text<{ $active: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ $active }) => ($active ? '#f68712' : '#374151')};
  margin-top: 6px;
`;

const Price = styled.Text`
  color: #f68712;
  font-size: 22px;
  font-weight: 800;
`;

const BottomActionBar = styled.View<{ bottomInset: number }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 20px ${({ bottomInset }: { bottomInset: number }) => Math.max(12, bottomInset + 8)}px;
  background-color: #fff;
  border-top-width: 1px;
  border-top-color: #efefef;
`;

const BottomActionRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const BottomSummary = styled.Text`
  color: #1a1a1a;
  font-size: 15px;
  font-weight: 700;
`;

const QuantityRow = styled.View`
  flex-direction: row;
  align-items: center;
  column-gap: 10px;
`;

const QtyBtn = styled.TouchableOpacity`
  background-color: #f68712;
  min-width: 56px;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
`;

const QtyText = styled.Text`
  color: #fff;
  font-size: 20px;
  font-weight: bold;
`;

const QtyValue = styled.Text`
  font-size: 22px;
  font-weight: 700;
  min-width: 28px;
  text-align: center;
`;

const AddButton = styled.TouchableOpacity<{ $disabled?: boolean }>`
  background-color: ${({ $disabled }) => ($disabled ? '#d1d5db' : '#f68712')};
  padding: 16px;
  border-radius: 10px;
  align-items: center;
  min-width: 190px;
`;

const AddText = styled.Text<{ $disabled?: boolean }>`
  color: ${({ $disabled }) => ($disabled ? '#4b5563' : '#fff')};
  font-size: 18px;
  font-weight: 800;
`;

const FoodTypeRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 6px;
`;

const FoodTypeLabel = styled.Text`
  margin-left: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
`;
