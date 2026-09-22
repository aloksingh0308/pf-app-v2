import { Category } from "@/types/Categories";
import styled from "styled-components/native";

interface Props {
    category: Category;
    onPress: () => void;
    selectedCategory: string;
}

const CategoryTile: React.FC<Props> = ({ category, onPress, selectedCategory }) => {
    return (
        <TileContainer style={{
            backgroundColor: selectedCategory === category.id ? "#F68712" : "#F3F4F6"
        }} onPress={onPress} activeOpacity={0.7}>
            <TileText style={{ color: selectedCategory === category.id ? "#FFF" : "#282939" }}>{category.name}</TileText>
        </TileContainer>
    );
}
export default CategoryTile;

const TileContainer = styled.TouchableOpacity`
  background-color: #F3F4F6;
  margin-right: 16px;
  border-radius: 20px;
  justify-content: center;
  align-items: center;
height: 45px;
padding: 0 16px;
`;

const TileText = styled.Text`
  font-size: 16px;
  font-weight: bold;
`;