import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import styled from 'styled-components/native';
import { AddonOption, ModifierGroup, Product, SelectedModifier } from '@/types/Product';
import { buildCartItemFromProduct, getProductVariants, getSelectedProductVariant } from '@/utils/productVariants';
import { getAddons, getModifiers } from '@/services/menuService';
import { showAlert } from '@/services/alertService';

type Props = {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
  onAdd: (cartItem: ReturnType<typeof buildCartItemFromProduct>) => void;
};

/**
 * The single bottom sheet for "I need to pick something before this goes in the cart" —
 * opened by ADD whenever an item has more than one variant, a modifier group, or an addon
 * (see ProductCard.tsx's onAddToCart / restaurant-details.tsx's handleQuickAddToCart). Shown
 * in that fixed order — Variant, then Modifiers, then Addons — since variant is the item's
 * own identity (changes the base price everything else builds on), modifiers are
 * item-specific customization, and addons are always-optional extras layered on top.
 * Product Details' own full-page selectors are a separate, still-working copy of this same
 * logic for when a customer taps into the item itself rather than quick-adding it.
 */
export default function CustomizeItemModal({ visible, product, onClose, onAdd }: Props) {
  const variants = product ? getProductVariants(product) : [];
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [addonOptions, setAddonOptions] = useState<AddonOption[]>([]);
  const [selectedModifierOptions, setSelectedModifierOptions] = useState<Record<string, string[]>>({});
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  useEffect(() => {
    if (!visible || !product) return;
    setSelectedVariantId(getProductVariants(product)[0]?.id || null);
    setSelectedAddonIds([]);

    const modifierGroupIds = new Set((product.modifierGroupIds || []).map(String));
    const addonIds = new Set((product.addonIds || []).map(String));
    if (modifierGroupIds.size === 0 && addonIds.size === 0) {
      setModifierGroups([]);
      setAddonOptions([]);
      setSelectedModifierOptions({});
      return;
    }

    let active = true;
    (async () => {
      try {
        const [allModifiers, allAddons] = await Promise.all([getModifiers(), getAddons()]);
        if (!active) return;
        const groups = allModifiers.filter((m) => modifierGroupIds.has(m.id));
        setModifierGroups(groups);
        setAddonOptions(allAddons.filter((a) => addonIds.has(a.id)));
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
  }, [visible, product?.firebaseId]);

  if (!product) return null;
  const selectedVariant = getSelectedProductVariant(product, selectedVariantId);

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

  const selectedModifiers: SelectedModifier[] = modifierGroups
    .map((group) => ({ modifierId: group.id, optionNames: selectedModifierOptions[group.id] || [] }))
    .filter((s) => s.optionNames.length > 0);

  const modifierPriceDelta = modifierGroups.reduce((sum, group) => {
    const chosen = new Set(selectedModifierOptions[group.id] || []);
    return sum + group.options.filter((o) => chosen.has(o.name)).reduce((s, o) => s + o.priceDelta, 0);
  }, 0);
  const addonPriceDelta = addonOptions.filter((a) => selectedAddonIds.includes(a.id)).reduce((sum, a) => sum + a.price, 0);
  const basePrice = Number(selectedVariant?.price ?? product.price ?? 0);
  const unitPrice = basePrice + modifierPriceDelta + addonPriceDelta;

  const missingRequiredGroup = modifierGroups.find(
    (group) => group.required && (selectedModifierOptions[group.id] || []).length < Math.max(1, group.minSelect)
  );

  const handleAdd = () => {
    if (missingRequiredGroup) {
      showAlert('Selection Required', `Please select an option for ${missingRequiredGroup.name}.`);
      return;
    }
    onAdd(
      buildCartItemFromProduct(product, selectedVariant?.id || null, {
        modifiers: selectedModifiers,
        addonIds: selectedAddonIds,
        modifierPriceDelta,
        addonPriceDelta,
      })
    );
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Overlay>
        <Backdrop onPress={onClose} />
        <Sheet>
          <Handle />
          <Header>
            <Title numberOfLines={1}>{product.name}</Title>
            <CloseButton onPress={onClose}>
              <Ionicons name="close" size={20} color="#1f2937" />
            </CloseButton>
          </Header>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {variants.length > 1 && (
              <Section>
                <SectionTitle>Select Variant</SectionTitle>
                {variants.map((variant) => {
                  const active = String(variant.id) === String(selectedVariant?.id || '');
                  return (
                    <OptionRow key={variant.id || variant.name} onPress={() => setSelectedVariantId(variant.id || null)} $active={active}>
                      <View>
                        <OptionLabel $active={active}>{variant.name}</OptionLabel>
                        {variant.description ? <OptionMeta $active={active}>{variant.description}</OptionMeta> : null}
                      </View>
                      <OptionPrice $active={active}>₹{Number(variant.price || 0).toFixed(2)}</OptionPrice>
                    </OptionRow>
                  );
                })}
              </Section>
            )}

            {modifierGroups.map((group) => (
              <Section key={group.id}>
                <SectionTitle>
                  {group.name}{group.required ? ' (Required)' : ' (Optional)'}
                  {group.multiSelect ? ` · Choose up to ${group.maxSelect}` : ''}
                </SectionTitle>
                {group.options.map((option) => {
                  const active = (selectedModifierOptions[group.id] || []).includes(option.name);
                  return (
                    <OptionRow key={option.name} onPress={() => toggleModifierOption(group, option.name)} $active={active}>
                      <OptionLabel $active={active}>{option.name}</OptionLabel>
                      {option.priceDelta > 0 ? <OptionPrice $active={active}>+₹{option.priceDelta.toFixed(2)}</OptionPrice> : null}
                    </OptionRow>
                  );
                })}
              </Section>
            ))}

            {addonOptions.length > 0 && (
              <Section>
                <SectionTitle>Add-ons (Optional)</SectionTitle>
                {addonOptions.map((addon) => {
                  const active = selectedAddonIds.includes(addon.id);
                  return (
                    <OptionRow key={addon.id} onPress={() => toggleAddon(addon.id)} $active={active}>
                      <OptionLabel $active={active}>{addon.name}</OptionLabel>
                      <OptionPrice $active={active}>+₹{addon.price.toFixed(2)}</OptionPrice>
                    </OptionRow>
                  );
                })}
              </Section>
            )}
          </ScrollView>

          <Footer>
            <FooterPrice>₹{unitPrice.toFixed(2)}</FooterPrice>
            <AddButton onPress={handleAdd} activeOpacity={0.85}>
              <AddButtonText>Add to Cart</AddButtonText>
            </AddButton>
          </Footer>
        </Sheet>
      </Overlay>
    </Modal>
  );
}

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: flex-end;
`;

const Backdrop = styled.Pressable`
  flex: 1;
`;

const Sheet = styled.View`
  background-color: #fff;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 12px 18px 18px 18px;
  max-height: 80%;
`;

const Handle = styled.View`
  align-self: center;
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background-color: #e5e7eb;
  margin-bottom: 10px;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const Title = styled.Text`
  flex: 1;
  font-size: 18px;
  font-weight: 800;
  color: #1f2937;
`;

const CloseButton = styled.TouchableOpacity`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  background-color: #f2f2f2;
`;

const Section = styled.View`
  margin-top: 14px;
`;

const SectionTitle = styled.Text`
  font-size: 14px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 8px;
`;

const OptionRow = styled.TouchableOpacity<{ $active: boolean }>`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  border-width: 1px;
  border-color: ${(props: { $active: boolean }) => (props.$active ? '#f68712' : '#e5e7eb')};
  background-color: ${(props: { $active: boolean }) => (props.$active ? '#fff7ef' : '#fff')};
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 8px;
`;

const OptionLabel = styled.Text<{ $active: boolean }>`
  font-size: 15px;
  font-weight: 700;
  color: ${(props: { $active: boolean }) => (props.$active ? '#c96a0a' : '#1f2937')};
`;

const OptionMeta = styled.Text<{ $active: boolean }>`
  font-size: 13px;
  color: ${(props: { $active: boolean }) => (props.$active ? '#9a6708' : '#6b7280')};
  margin-top: 4px;
`;

const OptionPrice = styled.Text<{ $active: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${(props: { $active: boolean }) => (props.$active ? '#f68712' : '#374151')};
`;

const Footer = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  padding-top: 14px;
  border-top-width: 1px;
  border-top-color: #efefef;
`;

const FooterPrice = styled.Text`
  color: #f68712;
  font-size: 20px;
  font-weight: 800;
`;

const AddButton = styled.TouchableOpacity`
  background-color: #f68712;
  border-radius: 10px;
  padding: 14px 28px;
`;

const AddButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: 800;
`;
