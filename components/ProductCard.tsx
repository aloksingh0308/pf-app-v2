// components/ProductCard.tsx
import { decrementQuantity, incrementQuantity } from '@/store/slices/cartSlice';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { memo, useCallback } from 'react';
import { Dimensions, TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { router } from 'expo-router';
import { showAlert } from '@/services/alertService';
import { useFavorite } from '@/services/favoritesService';
import styled from 'styled-components/native';
import { Product } from '../types/Product';
import AppImage from './AppImage';
import { T } from '@/constants/tokens';
import FoodTypeMark from './common/FoodTypeMark';
import { buildCartItemFromProduct, buildProductCartKey, getProductVariants } from '@/utils/productVariants';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';

const CARD_IMAGE_HEIGHT = 120;
const CARD_WIDTH = Math.floor(Dimensions.get('window').width * 0.9);

// BADGE COLORS
const BADGE_COLORS: Record<string, string> = {
  'BEST SELLER': '#43b02a',
  'POPULAR': '#ff9800',
  'SPICY': '#e53935',
  'HEALTHY': '#43b02a',
};

const getBadge = (product: Product) => {
  if ((product as any).isBestSeller) return 'BEST SELLER';
  if ((product as any).isMostOrdered) return 'POPULAR';
  if ((product as any).isBudgetPick) return 'BUDGET';
  if ((product as any).isSellingFast) return 'SELLING FAST';
  if ((product as any).isSpicy) return 'SPICY';
  if ((product as any).isHealthy) return 'HEALTHY';
  return null;
};

const getFeatureTags = (product: Product) => {
  // Example: You can customize this logic as per your data
  const tags = [];
  if ((product as any).isSpicy) tags.push({ label: 'Spicy', icon: 'whatshot', color: '#e53935' });
  if ((product as any).isHealthy) tags.push({ label: 'Light & Healthy', icon: 'spa', color: '#43b02a' });
  if ((product as any).quickBites) tags.push({ label: 'Quick Bites', icon: 'fastfood', color: '#f68712' });
  if ((product as any).cuisine) tags.push({ label: (product as any).cuisine, icon: 'restaurant-menu', color: '#888' });
  if ((product as any).time) tags.push({ label: (product as any).time, icon: 'schedule', color: '#888' });
  return tags;
};

const getRatingMeta = (product: Product) => {
  const ratingCount = Number(product.ratingCount || 0);
  if (ratingCount < 1) {
    return {
      value: 'NEW',
    };
  }

  return {
    value: Number(product.rating || 0).toFixed(1),
  };
};

interface Props {
  layout?: 'grid' | 'list';
  product: Product;
  /** Gets the product back, so a list can pass one stable handler to every (memoized) card. */
  onPress: (product: Product) => void;
  /** Opens the shared customize bottom sheet (variant + modifiers + addons) — fired
   *  instead of a direct add whenever the item has more than one variant, a modifier
   *  group, or an addon (see hasCustomization below). Kept as one callback (not a
   *  separate "multi-variant" one) since all three need the exact same sheet. */
  onCustomize?: (product: Product) => void;
  canAddToCart?: boolean;
  onAddUnavailablePress?: (product: Product) => void;
  isWithinServiceArea?: boolean;
  /** This card's own restaurant name — passed through to the cross-restaurant cart
   *  guard so its confirmation alert names both restaurants instead of falling back to
   *  generic "your other restaurant"/"this restaurant" wording. */
  restaurantName?: string;
}

const ProductCard: React.FC<Props> = memo(({ layout = 'grid', product, onPress, onCustomize, canAddToCart = true, onAddUnavailablePress, restaurantName }) => {
  const dispatch = useDispatch();
  const { addItem } = useAddToCartWithRestaurantGuard();
  const variants = getProductVariants(product);
  const hasMultipleVariants = variants.length > 1;
  const cartKey = buildProductCartKey({ ...product, selectedVariantId: variants[0]?.id || null });
  // Every cart row of this product (one per variant/customisation, combos excluded) — so a
  // "Large" added from the customise sheet still shows on the card and its stepper.
  const baseId = String(product.firebaseId || product.id || '');
  const cartRows: (Product & { quantity: number })[] = useSelector(
    (state: any) =>
      state.cart.items.filter(
        (item: Product) => !item.isDeal && String(item.baseProductId || item.firebaseId || item.id || '') === baseId
      ),
    shallowEqual
  );
  const cartQuantity = cartRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const outOfStock = product.inStock === false;

  // Saved on the customer's account (services/favoritesService.ts), keyed by the menu item id.
  const { isFavorite: isFav, toggle: toggleFav } = useFavorite('MENU_ITEM', baseId);

  // An item with more than one variant, a modifier group, or an addon needs a pick before
  // it can go in the cart — opens the shared CustomizeItemModal bottom sheet instead of
  // adding directly.
  const needsCustomization = hasMultipleVariants || (product.modifierGroupIds?.length || 0) > 0 || (product.addonIds?.length || 0) > 0;

  const onAddToCart = useCallback(() => {
    if (!canAddToCart) {
      onAddUnavailablePress?.(product);
      return;
    }
    if (needsCustomization) {
      onCustomize?.(product);
      return;
    }
    addItem(buildCartItemFromProduct(product, variants[0]?.id || null), { next: restaurantName });
  }, [canAddToCart, onAddUnavailablePress, addItem, needsCustomization, onCustomize, product, variants, restaurantName]);

  const handleIncrement = useCallback(() => {
    if (!canAddToCart) {
      onAddUnavailablePress?.(product);
      return;
    }
    // A customisable item's + adds another pick through the sheet, like Swiggy/Zomato.
    if (needsCustomization) {
      onCustomize?.(product);
      return;
    }
    if (cartRows[0]) dispatch(incrementQuantity(buildProductCartKey(cartRows[0])));
  }, [canAddToCart, onAddUnavailablePress, product, needsCustomization, onCustomize, dispatch, cartRows]);
  const handlePress = useCallback(() => onPress(product), [onPress, product]);

  const handleDecrement = useCallback(() => {
    if (cartRows.length === 1) {
      dispatch(decrementQuantity(buildProductCartKey(cartRows[0])));
      return;
    }
    // Several variants/customisations in the cart — the card can't tell which one to drop.
    showAlert('Remove from cart', `${product.name} has more than one customisation in your cart. Remove the one you don't want from the cart.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Go to cart', onPress: () => router.push({ pathname: '/user/cart' }) },
    ]);
  }, [dispatch, cartRows, product.name]);

  const isAdded = cartRows.length > 0;
  const imageUris = product.images && product.images.length > 0 ? product.images : ['https://via.placeholder.com/200'];
  const price = Number(product.price || 0);
  const featureTags = getFeatureTags(product);
  const badge = getBadge(product);
  const badgeColor = badge ? BADGE_COLORS[badge] || '#43b02a' : undefined;
  const ratingMeta = getRatingMeta(product);

  if (layout === 'list') {
    // Many menus repeat the name as the description ("Hot Coffee / Hot Coffee") — skip it.
    const description = String(product.description || '').trim();
    const showDescription = description.length > 0 && description.toLowerCase() !== String(product.name || '').trim().toLowerCase();
    return (
      <View style={listStyles.row}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <View style={listStyles.markRow}>
            {product.foodType ? <FoodTypeMark foodType={product.foodType} /> : null}
            {badge ? <Text style={listStyles.badgeText}>{badge}</Text> : null}
          </View>
          <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`View ${product.name}`} onPress={handlePress}>
            <Text style={listStyles.name}>{product.name}</Text>
            <Text style={listStyles.price}>₹{price.toFixed(0)}</Text>
            {showDescription ? <Text numberOfLines={2} style={listStyles.description}>{description}</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.8} accessibilityLabel={isFav ? 'Remove from favourites' : 'Save to favourites'} accessibilityRole="button" onPress={toggleFav} hitSlop={8} style={listStyles.fav}>
            <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={16} color={isFav ? T.color.danger : T.color.muted} />
          </TouchableOpacity>
        </View>
        <View style={listStyles.media}>
          <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`View ${product.name}`} onPress={handlePress} style={listStyles.photo}>
            <AppImage uri={imageUris[0]} style={{ width: '100%', height: '100%' }} />
            {outOfStock ? <View style={listStyles.stock}><Text style={listStyles.stockText}>Out of stock</Text></View> : null}
          </TouchableOpacity>
          <View style={listStyles.addWrap}>
            {!isAdded ? (
              <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Add ${product.name}`} onPress={onAddToCart} style={[listStyles.add, outOfStock && listStyles.addDisabled]}>
                <Text style={[listStyles.addText, outOfStock && { color: T.color.faint }]}>{outOfStock ? 'SOLD OUT' : 'ADD'}</Text>
                {!outOfStock ? <Ionicons name="add" size={14} color={T.color.brand} style={listStyles.addPlus} /> : null}
              </TouchableOpacity>
            ) : (
              <View style={[listStyles.add, listStyles.quantity]}>
                <TouchableOpacity activeOpacity={0.8} accessibilityLabel={`Remove one ${product.name}`} onPress={handleDecrement} style={listStyles.step}><Ionicons name="remove" size={16} color="#fff" /></TouchableOpacity>
                <Text style={listStyles.quantityText}>{cartQuantity}</Text>
                <TouchableOpacity activeOpacity={0.8} accessibilityLabel={`Add one ${product.name}`} onPress={handleIncrement} style={listStyles.step}><Ionicons name="add" size={16} color="#fff" /></TouchableOpacity>
              </View>
            )}
          </View>
          {needsCustomization ? <Text style={listStyles.customize}>Customisable</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <CardContainer>
      <ImagePressArea activeOpacity={1} disabled onPress={handlePress}>
        {badge && (
          <Badge style={{ backgroundColor: badgeColor }}>
            <BadgeText>{badge}</BadgeText>
          </Badge>
        )}
        <FavoriteIcon onPress={toggleFav} activeOpacity={0.8}>
          <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={20} color={isFav ? '#e53935' : '#e53935'} />
        </FavoriteIcon>
        <ProductImageContainer>
          <ProductImage uri={imageUris[0]}  style={{ height: CARD_IMAGE_HEIGHT }} />
          <RatingContainer>
            <Ionicons name="star" size={13} color="#fbbf24" />
            <Rating>{ratingMeta.value}</Rating>
          </RatingContainer>
          {outOfStock ? <OutOfStockOverlay>Out of Stock</OutOfStockOverlay> : null}
        </ProductImageContainer>
      </ImagePressArea>
      <Content activeOpacity={1} disabled onPress={handlePress}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          {product.foodType ? <View style={{ marginTop: 2 }}><FoodTypeMark foodType={product.foodType} size={13} /></View> : null}
          <Title numberOfLines={2} style={{ flex: 1 }}>{product.name}</Title>
        </View>
        <Description numberOfLines={2}>{product?.description}</Description>
        <Row>
          <PriceRow>
            <Price>₹{price.toFixed(0)}</Price>
          </PriceRow>
          {!isAdded ? (
            <AddButton onPress={onAddToCart} activeOpacity={0.8} $disabled={outOfStock}>
              <AddButtonText $disabled={outOfStock}>ADD</AddButtonText>
              <AddButtonIconBox $disabled={outOfStock}>
                <Ionicons name={outOfStock ? 'alert-circle-outline' : 'add'} size={20} color={outOfStock ? '#9ca3af' : '#f68712'} />
              </AddButtonIconBox>
            </AddButton>
          ) : (
            <StyledQuantityRow>
              <StyledQtyBtn onPress={handleDecrement} activeOpacity={0.8} >
                <StyledQtyText>-</StyledQtyText>
              </StyledQtyBtn>
              <StyledQtyValue>{cartQuantity}</StyledQtyValue>
              <StyledQtyBtn onPress={handleIncrement} activeOpacity={0.8} >
                <StyledQtyText>+</StyledQtyText>
              </StyledQtyBtn>
            </StyledQuantityRow>
          )}
        </Row>
        <FeatureTagsRow>
          {featureTags.map((tag, idx) => (
            <FeatureTag key={idx}>
                <Ionicons name={tag.icon as any} size={14} color={tag.color} />
              <FeatureTagText style={{ color: tag.color }}>{tag.label}</FeatureTagText>
            </FeatureTag>
          ))}
        </FeatureTagsRow>
      </Content>
    </CardContainer>
  );
});

ProductCard.displayName = 'ProductCard';

export default ProductCard;

const CardContainer = styled.View.attrs({
  style: {
    shadowColor: '#282939',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5
  }
})`
  background-color: #fff;
  border-radius: 12px;
  margin-bottom: 16px;
  width: 48%;
  align-self: center;
  border: 1px solid #f0f0f0;
  shadow-color: #000;
  shadow-offset: 0px 0px;
  shadow-opacity: 0.1;
  shadow-radius: 4px;
  elevation: 1;
`;

const ImagePressArea = styled(TouchableOpacity).attrs({ activeOpacity: 0.8 })`
  width: 100%;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  background-color: #f0f0f0;
  overflow: hidden;
`;

const ProductImage = styled(AppImage)`
  width: 100%;
  height: 130px;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
`;

const Content = styled(TouchableOpacity).attrs({ activeOpacity: 0.8 })`
  padding: 12px 12px 2px 12px;
`;

const Title = styled.Text`
  font-size: 14px;
  font-weight: 700;
  color: #1a1a1a;
`;

const Row = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 8px;
  align-items: center;
`;

const PriceRow = styled.View`
  flex-direction: row;
  align-items: baseline;
  column-gap: 2px;
`;

const Price = styled.Text`
  color: #f68712;
  font-size: 16px;
  font-weight: bold;
`;

const Rating = styled.Text`
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  margin-left: 4px;
`;

const RatingContainer = styled.View`
  flex-direction: row;
  align-items: center;
  position: absolute;
  right: 8px;
  bottom: 8px;
  background-color: rgba(17, 24, 39, 0.72);
  padding: 4px 8px;
  border-radius: 12px;
  z-index: 3;
`;

const AddButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $disabled?: boolean }>`
  background-color: ${({ $disabled }: { $disabled?: boolean }) => ($disabled ? '#e5e7eb' : '#f68712')};
  border-radius: 22px;
  flex-direction: row;
  align-items: center;
  padding: 4px 3px 4px 7px;
  min-width: 20px;
  justify-content: space-around;
  opacity: ${(props: any) => (props.disabled ? 0.65 : 1)};
`;

const AddButtonText = styled.Text<{ $disabled?: boolean }>`
  color: ${({ $disabled }: { $disabled?: boolean }) => ($disabled ? '#6b7280' : '#fff')};
  font-size: 14px;
  font-weight: bold;
  margin-right: 8px;
`;

const AddButtonIconBox = styled.View<{ $disabled?: boolean }>`
  background: ${({ $disabled }: { $disabled?: boolean }) => ($disabled ? '#f3f4f6' : '#fff')};
  border-radius: 50px;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
`;

const QuantityRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const QtyBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  background-color: #f68712;
  padding: 6px 12px;
  border-radius: 8px;
`;

const QtyText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: bold;
`;

const QtyValue = styled.Text`
  font-size: 14px;
  margin: 0 5px;
  font-weight: bold;
`;

const Badge = styled.View`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  padding: 2px 10px;
  border-radius: 10px;
`;
const BadgeText = styled.Text`
  color: #fff;
  font-size: 11px;
  font-weight: bold;
`;
const FavoriteIcon = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  background: #fff;
  border-radius: 12px;
  padding: 2px;
  elevation: 2;
`;
const Description = styled.Text`
  color: #666;
  font-size: 12px;
  margin-top: 2px;
`;
const MetaRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 2px;
`;
const MetaItem = styled.View`
  flex-direction: row;
  align-items: center;
  margin-right: 12px;
`;
const MetaText = styled.Text`
  color: #222;
  font-size: 13px;
  margin-left: 3px;
  font-weight: 700;
`;
const MetaSubText = styled.Text`
  color: #888;
  font-size: 12px;
  margin-left: 2px;
`;
const DiscountBadge = styled.Text`
  background: #e6f4ea;
  color: #43b02a;
  font-size: 13px;
  font-weight: bold;
  border-radius: 6px;
  padding: 2px 7px;
  margin-left: 6px;
`;
const FeatureTagsRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 8px;
  gap: 6px;
`;
const FeatureTag = styled.View`
  flex-direction: row;
  align-items: center;
  background: #f7f7f7;
  border-radius: 8px;
  padding: 2px 7px 2px 4px;
  margin-right: 6px;
  margin-bottom: 4px;
`;
const FeatureTagText = styled.Text`
  font-size: 12px;
  margin-left: 3px;
  font-weight: 600;
`;

const AddButtonRow = styled.View`
  flex-direction: row;
  justify-content: center;
  margin-top: 10px;
  margin-bottom: 2px;
`;
const ProductImageContainer = styled.View`
  position: relative;
  width: 100%;
`;

const OutOfStockOverlay = styled.Text`
  position: absolute;
  left: 8px;
  right: 8px;
  top: 50%;
  text-align: center;
  transform: translateY(-12px);
  background-color: rgba(31, 41, 55, 0.70);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  border-radius: 999px;
  padding: 6px 10px;
  overflow: hidden;
  z-index: 2;
`;
const StyledQuantityRow = styled.View`
  flex-direction: row;
  align-items: center;
  border: 1.5px solid #f68712;
  border-radius: 16px;
  background: #fff;
  padding: 2px 10px;
  min-width: 80px;
  justify-content: center;
`;

const StyledQtyBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  background: transparent;
  padding: 2px 3px;
  border-radius: 12px;
`;

const StyledQtyText = styled.Text`
  color: #f68712;
  font-size: 20px;
  font-weight: bold;
`;

const StyledQtyValue = styled.Text`
  font-size: 18px;
  font-weight: bold;
  color: #f68712;
  margin: 0 8px;
`;

// --- FAVORITE HEADER ICON (to be used in your header/navigation component) ---
// Example usage in your header:
// <TouchableOpacity onPress={() => navigation.navigate('FavoritesScreen')}>
//   <MaterialIcons name="favorite" size={26} color="#e53935" />
// </TouchableOpacity>
//
// Place this icon in your header/navigation bar to allow users to view all their favorite items.
//
// --- END FAVORITE HEADER ICON ---


const listStyles = StyleSheet.create({
  row: { flexDirection: 'row', paddingTop: 18, paddingBottom: 22, marginHorizontal: 16, borderBottomWidth: 1, borderBottomColor: T.color.line },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  badgeText: { color: T.color.brand, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  name: { fontSize: 16, fontWeight: '700', color: T.color.ink },
  price: { fontSize: 15, color: T.color.ink, fontWeight: '700', marginTop: 4 },
  description: { fontSize: 13, lineHeight: 18, color: T.color.muted, marginTop: 6 },
  fav: { alignSelf: 'flex-start', marginTop: 10, padding: 6, borderRadius: T.radius.pill, borderWidth: 1, borderColor: T.color.line },
  media: { width: 128, alignItems: 'center' },
  photo: { width: 128, height: 120, borderRadius: T.radius.lg, overflow: 'hidden', backgroundColor: '#f4f4f4' },
  stock: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  stockText: { color: T.color.inkSoft, fontSize: 11, fontWeight: '800' },
  addWrap: { marginTop: -20 },
  add: { minWidth: 104, height: 38, borderRadius: T.radius.md, backgroundColor: T.color.surface, borderWidth: 1, borderColor: T.color.brandBorder, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', ...T.shadow.card },
  addDisabled: { borderColor: T.color.line },
  addText: { color: T.color.brand, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  addPlus: { position: 'absolute', top: 2, right: 4 },
  quantity: { backgroundColor: T.color.brand, borderColor: T.color.brand, justifyContent: 'space-between' },
  step: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  quantityText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  customize: { color: T.color.faint, fontSize: 10, marginTop: 6 },
});
