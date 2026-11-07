import { Icon } from './Icon';

export const ListVideo = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M12 12H3M16 6H3M12 18H3" />
        <path d="m16 12 5 3-5 3v-6Z" />
    </Icon>
);
