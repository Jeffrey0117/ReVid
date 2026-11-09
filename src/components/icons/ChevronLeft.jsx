import { Icon } from './Icon';

export const ChevronLeft = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <polyline points="15 18 9 12 15 6" />
    </Icon>
);
