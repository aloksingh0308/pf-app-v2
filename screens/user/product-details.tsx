import { PRIMARY_BUTTON_GUTTER, PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_TEXT_STYLE } from '@/components/common/AppButton';
import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import AppImage from '@/components/AppImage';
import { useAppLoader } from '@/hooks/useAppLoader';
import { calculateCartTotals } from '@/utils/dealCart';
import Ionicons from '@react-native-vector-icons/ionicons';
import FoodTypeMark, { FOOD_TYPE_LABELS } from '@/components/common/FoodTypeMark';
import { decrementQuantity, incrementQuantity } from '@/store/slices/cartSlice';
import { AddonOption, ModifierGroup, Product, SelectedModifier } from '@/types/Product';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { buildCartItemFromProduct, buildProductCartKey, getProductVariants, getSelectedProductVariant } from '@/utils/productVariants';
import { showAlert } from '@/services/alertService';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { getAddons, getModifiers } from '@/services/menuService';
import { T } from '@/constants/tokens';

const ProductDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const appLoader = useAppLoader();
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

  const imageUri = parsedProduct.images && parsedProduct.images.length > 0 ? fixFirebaseUrl(parsedProduct.images?.[0]) : '';
  const qtyAndServes = [parsedProduct.qty, parsedProduct.serves]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' • ');
  const description = String(parsedProduct.description || '').trim();
  const variantPrice = Number(selectedVariant?.price ?? parsedProduct.price ?? 0);
  const unitPrice = variantPrice + modifierPriceDelta + addonPriceDelta;
  // A lone variant (usually "Regular") is not a choice — skip the picker and just show the price.
  const showVariantPicker = variants.length > 1;
  const cartCount = useMemo(() => calculateCartTotals(cartItems as any).displayCount, [cartItems]);

  const openCart = () => {
    appLoader.show();
    router.push({ pathname: '/user/cart' });
  };

  return (
    <Screen>
      <PageHeader title="Item Details" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <ImageWrap>
          {imageUri ? (
            <ProductImage uri={imageUri} contentFit="cover" />
          ) : (
            <ImageFallback>
              <Ionicons name="restaurant-outline" size={48} color="#f5b97a" />
            </ImageFallback>
          )}
          {outOfStock ? (
            <SoldOutOverlay>
              <SoldOutText>Currently unavailable</SoldOutText>
            </SoldOutOverlay>
          ) : null}
        </ImageWrap>

        <InfoBlock>
          {parsedProduct.foodType ? (
            <FoodTypeRow>
              <FoodTypeMark foodType={parsedProduct.foodType} size={14} />
              <FoodTypeLabel>{FOOD_TYPE_LABELS[parsedProduct.foodType]}</FoodTypeLabel>
            </FoodTypeRow>
          ) : null}
          <Title>{parsedProduct.name}</Title>
          {qtyAndServes ? <MetaText>{qtyAndServes}</MetaText> : null}
          <PriceRow>
            <Price>{formatPrice(unitPrice)}</Price>
            {showVariantPicker && selectedVariant?.name ? <PriceNote>· {selectedVariant.name}</PriceNote> : null}
          </PriceRow>
          {description && description.toLowerCase() !== String(parsedProduct.name || '').toLowerCase() ? (
            <Description>{description}</Description>
          ) : null}
        </InfoBlock>

        {showVariantPicker ? (
          <Section>
            <SectionHeader>
              <SectionTitle>Choose an option</SectionTitle>
              <Tag $required>Required</Tag>
            </SectionHeader>
            <OptionList>
              {variants.map((variant, index) => {
                const active = String(variant.id) === String(selectedVariant?.id || '');
                const meta = String(variant.description || '').trim();
                return (
                  <OptionRow
                    key={variant.id || variant.name}
                    onPress={() => setSelectedVariantId(variant.id || null)}
                    $last={index === variants.length - 1}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                  >
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? T.color.brand : '#c4c8cf'} />
                    <OptionTextWrap>
                      <OptionName $active={active}>{variant.name}</OptionName>
                      {meta && meta.toLowerCase() !== String(variant.name || '').toLowerCase() ? <OptionMeta>{meta}</OptionMeta> : null}
                    </OptionTextWrap>
                    <OptionPrice $active={active}>{formatPrice(Number(variant.price || 0))}</OptionPrice>
                  </OptionRow>
                );
              })}
            </OptionList>
          </Section>
        ) : null}

        {modifierGroups.map((group) => (
          <Section key={group.id}>
            <SectionHeader>
              <SectionTitle>{group.name}</SectionTitle>
              <Tag $required={group.required}>{group.required ? 'Required' : 'Optional'}</Tag>
            </SectionHeader>
            {group.multiSelect ? <SectionHint>Choose up to {group.maxSelect}</SectionHint> : null}
            <OptionList>
              {group.options.map((option, index) => {
                const active = (selectedModifierOptions[group.id] || []).includes(option.name);
                const icon = group.multiSelect
                  ? (active ? 'checkbox' : 'square-outline')
                  : (active ? 'radio-button-on' : 'radio-button-off');
                return (
                  <OptionRow
                    key={option.name}
                    onPress={() => toggleModifierOption(group, option.name)}
                    $last={index === group.options.length - 1}
                    accessibilityRole={group.multiSelect ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: active }}
                  >
                    <Ionicons name={icon} size={20} color={active ? T.color.brand : '#c4c8cf'} />
                    <OptionTextWrap>
                      <OptionName $active={active}>{option.name}</OptionName>
                    </OptionTextWrap>
                    {option.priceDelta > 0 ? <OptionPrice $active={active}>+{formatPrice(option.priceDelta)}</OptionPrice> : null}
                  </OptionRow>
                );
              })}
            </OptionList>
          </Section>
        ))}

        {addonOptions.length > 0 && (
          <Section>
            <SectionHeader>
              <SectionTitle>Add-ons</SectionTitle>
              <Tag>Optional</Tag>
            </SectionHeader>
            <OptionList>
              {addonOptions.map((addon, index) => {
                const active = selectedAddonIds.includes(addon.id);
                return (
                  <OptionRow
                    key={addon.id}
                    onPress={() => toggleAddon(addon.id)}
                    $last={index === addonOptions.length - 1}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                  >
                    <Ionicons name={active ? 'checkbox' : 'square-outline'} size={20} color={active ? T.color.brand : '#c4c8cf'} />
                    <OptionTextWrap>
                      <OptionName $active={active}>{addon.name}</OptionName>
                    </OptionTextWrap>
                    <OptionPrice $active={active}>+{formatPrice(addon.price)}</OptionPrice>
                  </OptionRow>
                );
              })}
            </OptionList>
          </Section>
        )}
      </ScrollView>

      <BottomActionBar style={{ paddingBottom: Math.max(12, insets.bottom + 8) }}>
        {isAdded ? (
          <>
            <Stepper>
              <StepBtn onPress={handleDecrement} accessibilityRole="button" accessibilityLabel={`Remove one ${parsedProduct.name}`}>
                <Ionicons name="remove" size={20} color={T.color.brand} />
              </StepBtn>
              <StepValue>{currentQty}</StepValue>
              <StepBtn onPress={handleIncrement} accessibilityRole="button" accessibilityLabel={`Add one ${parsedProduct.name}`}>
                <Ionicons name="add" size={20} color={T.color.brand} />
              </StepBtn>
            </Stepper>
            <PrimaryButton onPress={openCart} activeOpacity={0.8}>
              <PrimaryText>View cart{cartCount ? ` (${cartCount})` : ''}</PrimaryText>
              <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 6 }} />
            </PrimaryButton>
          </>
        ) : (
          <>
            {cartCount > 0 ? (
              <CartIconButton onPress={openCart} accessibilityRole="button" accessibilityLabel={`View cart, ${cartCount} items`}>
                <Ionicons name="bag-handle-outline" size={22} color={T.color.brand} />
                <CartBadge>
                  <CartBadgeText>{cartCount}</CartBadgeText>
                </CartBadge>
              </CartIconButton>
            ) : null}
            <PrimaryButton onPress={handleAddToCart} $disabled={outOfStock} activeOpacity={0.8}>
              {outOfStock ? (
                <PrimaryText $disabled>Out of stock</PrimaryText>
              ) : (
                <>
                  <PrimaryText>Add item</PrimaryText>
                  <PrimaryDivider />
                  <PrimaryText>{formatPrice(unitPrice)}</PrimaryText>
                </>
              )}
            </PrimaryButton>
          </>
        )}
      </BottomActionBar>
    </Screen>
  );
};

/** ₹55 for whole rupees, ₹55.50 otherwise. */
const formatPrice = (value: number) => `₹${Number.isInteger(value) ? value : value.toFixed(2)}`;

export default ProductDetailScreen;

const Screen = styled(PageScreen)`
  flex: 1;
  background-color: #fff;
`;

const ImageWrap = styled.View`
  width: 100%;
  aspect-ratio: 1.33;
  border-radius: 18px;
  overflow: hidden;
  background-color: #f5f5f5;
`;

const ProductImage = styled(AppImage)`
  width: 100%;
  height: 100%;
`;

const ImageFallback = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: #fff4ea;
`;

const SoldOutOverlay = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px;
  background-color: rgba(17, 24, 39, 0.65);
  align-items: center;
`;

const SoldOutText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 700;
`;

const InfoBlock = styled.View`
  padding: 16px 2px 4px;
`;

const FoodTypeRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 8px;
`;

const FoodTypeLabel = styled.Text`
  margin-left: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
`;

const Title = styled.Text`
  font-size: 24px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const MetaText = styled.Text`
  font-size: 14px;
  color: #6b7280;
  margin-top: 4px;
  font-weight: 500;
`;

const PriceRow = styled.View`
  flex-direction: row;
  align-items: baseline;
  margin-top: 10px;
`;

const Price = styled.Text`
  color: ${T.color.ink};
  font-size: 22px;
  font-weight: 800;
`;

const PriceNote = styled.Text`
  margin-left: 6px;
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
`;

const Description = styled.Text`
  font-size: 15px;
  color: #4b5563;
  margin-top: 10px;
  line-height: 22px;
`;

const Section = styled.View`
  margin-top: 16px;
  border-width: 1px;
  border-color: #eef0f3;
  border-radius: 16px;
  padding: 14px 14px 4px;
  background-color: #fff;
`;

const SectionHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const SectionTitle = styled.Text`
  flex: 1;
  font-size: 16px;
  font-weight: 700;
  color: ${T.color.ink};
`;

const SectionHint = styled.Text`
  font-size: 13px;
  color: #6b7280;
  margin-top: 2px;
`;

const Tag = styled.Text<{ $required?: boolean }>`
  font-size: 11px;
  font-weight: 700;
  overflow: hidden;
  padding: 3px 8px;
  border-radius: 10px;
  color: ${({ $required }: { $required?: boolean }) => ($required ? '#c2410c' : T.color.muted)};
  background-color: ${({ $required }: { $required?: boolean }) => ($required ? '#fff1e6' : '#f3f4f6')};
`;

const OptionList = styled.View`
  margin-top: 6px;
`;

const OptionRow = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $last?: boolean }>`
  flex-direction: row;
  align-items: center;
  min-height: 48px;
  padding: 10px 0;
  border-bottom-width: ${({ $last }: { $last?: boolean }) => ($last ? 0 : 1)}px;
  border-bottom-color: #f1f2f4;
`;

const OptionTextWrap = styled.View`
  flex: 1;
  margin-left: 12px;
`;

const OptionName = styled.Text<{ $active: boolean }>`
  font-size: 15px;
  font-weight: ${({ $active }: { $active: boolean }) => ($active ? 700 : 500)};
  color: ${T.color.ink};
`;

const OptionMeta = styled.Text`
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
`;

const OptionPrice = styled.Text<{ $active: boolean }>`
  margin-left: 12px;
  font-size: 15px;
  font-weight: 600;
  color: ${({ $active }: { $active: boolean }) => ($active ? T.color.ink : '#4b5563')};
`;

const BottomActionBar = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  flex-direction: row;
  align-items: center;
  column-gap: 12px;
  padding: 12px ${PRIMARY_BUTTON_GUTTER}px;
  background-color: #fff;
  border-top-width: 1px;
  border-top-color: #efefef;
  elevation: 12;
  shadow-color: #000;
  shadow-opacity: 0.06;
  shadow-radius: 8px;
`;

const PrimaryButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $disabled?: boolean }>`
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  padding: 0 ${PRIMARY_BUTTON_STYLE.paddingHorizontal}px;
  border-radius: ${PRIMARY_BUTTON_STYLE.borderRadius}px;
  background-color: ${({ $disabled }: { $disabled?: boolean }) => ($disabled ? '#d1d5db' : PRIMARY_BUTTON_STYLE.backgroundColor)};
`;

const PrimaryText = styled.Text<{ $disabled?: boolean }>`
  color: ${({ $disabled }: { $disabled?: boolean }) => ($disabled ? '#4b5563' : PRIMARY_BUTTON_TEXT_STYLE.color)};
  font-size: ${PRIMARY_BUTTON_TEXT_STYLE.fontSize}px;
  font-weight: ${PRIMARY_BUTTON_TEXT_STYLE.fontWeight};
`;

const PrimaryDivider = styled.View`
  width: 1px;
  height: 18px;
  margin: 0 12px;
  background-color: rgba(255, 255, 255, 0.5);
`;

const Stepper = styled.View`
  flex-direction: row;
  align-items: center;
  height: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  border-width: 1.5px;
  border-color: ${T.color.brand};
  border-radius: ${PRIMARY_BUTTON_STYLE.borderRadius}px;
  background-color: #fff7ef;
`;

const StepBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: 44px;
  height: 100%;
  align-items: center;
  justify-content: center;
`;

const StepValue = styled.Text`
  min-width: 24px;
  text-align: center;
  font-size: 17px;
  font-weight: 800;
  color: ${T.color.brand};
`;

const CartIconButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  height: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  border-radius: ${PRIMARY_BUTTON_STYLE.borderRadius}px;
  border-width: 1.5px;
  border-color: ${T.color.brand};
  background-color: #fff7ef;
  align-items: center;
  justify-content: center;
`;

const CartBadge = styled.View`
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background-color: ${T.color.brand};
  border-width: 2px;
  border-color: #fff;
  align-items: center;
  justify-content: center;
`;

const CartBadgeText = styled.Text`
  color: #fff;
  font-size: 10px;
  font-weight: 800;
`;
